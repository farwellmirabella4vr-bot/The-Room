// ============================================================
// TRAVEL WORLD — a Battlefront-style planet-select globe for real
// travel destinations. Plain Three.js (vendored locally in lib/, not
// a CDN — this room works fully offline, same as every other room in
// this project, once served over HTTP for the fetch()/module-import
// calls below; opening index.html directly as a local file:// URL
// will fail both the module import and the destination data fetch).
//
// Loads destinations/manifest.json (a list of place-slugs) then each
// place's own destinations/<slug>/info.json. Adding a new place is:
// create the folder, drop in photos/videos, fill in info.json, add
// one line to manifest.json. No code changes.
// ============================================================

import * as THREE from './lib/three.module.min.js';

const GLOBE_RADIUS = 5;
const MARKER_OFFSET = 0.05;
const DEFAULT_CAM_POS = new THREE.Vector3(0, 2.2, 13.5);

let scene, camera, renderer, globeGroup, globeMesh, markersGroup, clock;
let raycaster, mouseNDC;
let animatingCamera = false;
let currentView = "orbit"; // "orbit" | "focused"
let places = [];

// drag-to-rotate state
let isDragging = false;
let dragMoved = false;
let dragLastX = 0;
let dragLastY = 0;

// ---------- lat/lng -> point on the globe ----------
function latLngToVector3(lat, lng, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------- scene setup ----------
function initScene(canvas) {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 1000);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  resizeRenderer();

  scene.add(new THREE.AmbientLight(0x8899aa, 0.7));
  const keyLight = new THREE.DirectionalLight(0xf2c879, 1.15);
  keyLight.position.set(6, 8, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x6a8ac9, 0.55);
  rimLight.position.set(-8, -4, -6);
  scene.add(rimLight);

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // Stylized, low-cost globe — a solid jewel-tone sphere plus a
  // faint wireframe shell for a holographic-tactical-display look,
  // deliberately not a photoreal earth texture (keeps this cheap and
  // matches the Battlefront planet-select aesthetic being asked for).
  const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 48, 48);
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0x123a52,
    emissive: 0x0a1f33,
    emissiveIntensity: 0.4,
    metalness: 0.25,
    roughness: 0.7,
  });
  globeMesh = new THREE.Mesh(globeGeo, globeMat);
  globeGroup.add(globeMesh);

  const wireGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.01, 24, 16);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xf2c879, wireframe: true, transparent: true, opacity: 0.14 });
  globeGroup.add(new THREE.Mesh(wireGeo, wireMat));

  scene.add(buildStarfield());

  markersGroup = new THREE.Group();
  globeGroup.add(markersGroup);

  raycaster = new THREE.Raycaster();
  mouseNDC = new THREE.Vector2();
  clock = new THREE.Clock();

  window.addEventListener("resize", resizeRenderer);
  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
}

function buildStarfield() {
  const count = 1600;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 60 + Math.random() * 100;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xf4e8d0, size: 0.14, transparent: true, opacity: 0.75, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

function resizeRenderer() {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// ---------- markers ----------
function addMarkers(placeList) {
  placeList.forEach((place) => {
    const pos = latLngToVector3(place.lat, place.lng, GLOBE_RADIUS + MARKER_OFFSET);

    const markerGeo = new THREE.SphereGeometry(0.09, 12, 12);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xf2c879 });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(pos);
    marker.userData.place = place;
    markersGroup.add(marker);

    const glowGeo = new THREE.SphereGeometry(0.17, 10, 10);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xf2c879, transparent: true, opacity: 0.32 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(pos);
    glow.userData.isGlow = true;
    markersGroup.add(glow);
  });
}

function pickableMarkers() {
  return markersGroup.children.filter((m) => !m.userData.isGlow);
}

// ---------- drag-to-rotate ----------
function onPointerDown(e) {
  if (currentView !== "orbit" || animatingCamera) return;
  isDragging = true;
  dragMoved = false;
  dragLastX = e.clientX;
  dragLastY = e.clientY;
}
function onPointerMove(e) {
  if (isDragging) {
    const dx = e.clientX - dragLastX;
    const dy = e.clientY - dragLastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    globeGroup.rotation.y += dx * 0.006;
    globeGroup.rotation.x = Math.max(-0.9, Math.min(0.9, globeGroup.rotation.x + dy * 0.006));
    renderer.domElement.style.cursor = "grabbing";
    return;
  }
  if (animatingCamera || currentView === "focused") {
    renderer.domElement.style.cursor = "default";
    return;
  }
  renderer.domElement.style.cursor = raycastAtPointer(e) ? "pointer" : "default";
}
function onPointerUp() {
  isDragging = false;
  renderer.domElement.style.cursor = "default";
}

function onCanvasClick(e) {
  if (dragMoved) { dragMoved = false; return; } // this click was really the end of a drag
  if (animatingCamera || currentView === "focused") return;
  const hit = raycastAtPointer(e);
  if (hit) flyToPlace(hit.userData.place);
}

// Raycasts markers only, then discards a hit if the globe surface itself
// is closer along the same ray — i.e. the marker is on the far side of
// the globe from the camera and shouldn't be clickable through it.
function raycastAtPointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);

  const markerHits = raycaster.intersectObjects(pickableMarkers());
  if (!markerHits.length) return null;

  const globeHits = raycaster.intersectObject(globeMesh);
  if (globeHits.length && globeHits[0].distance < markerHits[0].distance - 0.01) return null;

  return markerHits[0].object;
}

// ---------- camera fly-to (restrained cinematic: eased pan+zoom, no wipe/flash) ----------
function animateCamera(targetPos, targetQuat, duration, onDone) {
  animatingCamera = true;
  const startPos = camera.position.clone();
  const startQuat = camera.quaternion.clone();
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = easeInOutCubic(t);
    camera.position.lerpVectors(startPos, targetPos, eased);
    camera.quaternion.slerpQuaternions(startQuat, targetQuat, eased);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      animatingCamera = false;
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(step);
}

function flyToPlace(place) {
  currentView = "focused";
  const surfacePoint = latLngToVector3(place.lat, place.lng, GLOBE_RADIUS);
  const camTargetPos = surfacePoint.clone().normalize().multiplyScalar(GLOBE_RADIUS + 2.3);

  const tempCam = camera.clone();
  tempCam.position.copy(camTargetPos);
  tempCam.lookAt(surfacePoint);

  animateCamera(camTargetPos, tempCam.quaternion.clone(), 1300, () => openPanel(place));
}

function flyBackToOrbit() {
  const tempCam = camera.clone();
  tempCam.position.copy(DEFAULT_CAM_POS);
  tempCam.lookAt(0, 0, 0);
  animateCamera(DEFAULT_CAM_POS.clone(), tempCam.quaternion.clone(), 1000, () => {
    currentView = "orbit";
  });
}

// ---------- render loop (pauses while the tab is hidden) ----------
function animate() {
  if (document.hidden) return;
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const t = clock.elapsedTime;

  if (currentView === "orbit" && !animatingCamera && !isDragging) {
    globeGroup.rotation.y += delta * 0.05;
  }
  markersGroup.children.forEach((child) => {
    if (child.userData.isGlow) {
      child.scale.setScalar(1 + Math.sin(t * 2 + child.position.x * 3) * 0.15);
    }
  });

  renderer.render(scene, camera);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestAnimationFrame(animate);
});

// ---------- data loading ----------
async function loadPlaces() {
  const manifestRes = await fetch("destinations/manifest.json");
  if (!manifestRes.ok) throw new Error("manifest fetch failed: " + manifestRes.status);
  const manifest = await manifestRes.json();
  const slugs = Array.isArray(manifest.places) ? manifest.places : [];

  const loaded = await Promise.all(slugs.map(async (slug) => {
    try {
      const res = await fetch("destinations/" + slug + "/info.json");
      if (!res.ok) return null;
      const info = await res.json();
      return Object.assign({ slug }, info);
    } catch (e) {
      return null; // one bad/missing place shouldn't take down the whole globe
    }
  }));
  return loaded.filter(Boolean);
}

// ---------- place panel ----------
function openPanel(place) {
  document.getElementById("placeName").textContent = place.name || place.slug;
  document.getElementById("placeDates").textContent = place.dates || "";
  document.getElementById("placeNotes").textContent = place.notes || "";

  const gallery = document.getElementById("placeGallery");
  gallery.innerHTML = "";
  (place.photos || []).forEach((src) => {
    const img = document.createElement("img");
    img.src = "destinations/" + place.slug + "/" + src;
    img.loading = "lazy";
    img.alt = place.name || place.slug;
    img.className = "gallery-photo";
    gallery.appendChild(img);
  });

  const videoWrap = document.getElementById("placeVideos");
  const videoLabel = document.getElementById("placeVideosLabel");
  videoWrap.innerHTML = "";
  const videos = place.videos || [];
  const hasVideos = videos.length > 0;
  videoWrap.hidden = !hasVideos;
  videoLabel.hidden = !hasVideos;
  videos.forEach((src) => {
    const video = document.createElement("video");
    video.src = "destinations/" + place.slug + "/" + src;
    video.controls = true;
    video.preload = "none";
    video.className = "gallery-video";
    videoWrap.appendChild(video);
  });

  const panel = document.getElementById("placePanel");
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
}

function closePanel() {
  const panel = document.getElementById("placePanel");
  panel.classList.remove("open");
  setTimeout(() => { panel.hidden = true; }, 400);
  flyBackToOrbit();
}

// ---------- loading screen ----------
function hideLoadingScreen() {
  const loader = document.getElementById("loadingScreen");
  loader.classList.add("done");
  setTimeout(() => { loader.hidden = true; }, 700);
}
function showLoadError(message) {
  const status = document.getElementById("loadingStatus");
  status.textContent = message;
}

// ---------- init ----------
async function main() {
  const canvas = document.getElementById("globeCanvas");
  initScene(canvas);

  document.getElementById("panelCloseBtn").addEventListener("click", closePanel);

  try {
    places = await loadPlaces();
  } catch (e) {
    showLoadError("Could not load travel data. This page needs to be served over HTTP (e.g. a local dev server) — opening index.html directly as a local file won't work.");
    return;
  }

  if (!places.length) {
    showLoadError("No destinations found in destinations/manifest.json.");
    return;
  }

  addMarkers(places);
  requestAnimationFrame(animate);
  hideLoadingScreen();

  // Read-only debug hook (no effect on normal use) so this scene's real
  // state — camera, live marker screen positions — can be inspected from
  // outside the module for testing, without exposing anything mutable.
  window.__travelWorldDebug = {
    getMarkerScreenPositions() {
      const rect = renderer.domElement.getBoundingClientRect();
      return pickableMarkers().map((m) => {
        const p = m.getWorldPosition(new THREE.Vector3()).project(camera);
        return {
          slug: m.userData.place.slug,
          x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
          facingCamera: p.z < 1,
        };
      });
    },
    getView() { return currentView; },
    diagnoseClickAt(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const markerHits = raycaster.intersectObjects(pickableMarkers());
      const globeHits = raycaster.intersectObject(globeMesh);
      return {
        markerHitCount: markerHits.length,
        markerDistance: markerHits.length ? markerHits[0].distance : null,
        markerSlug: markerHits.length ? markerHits[0].object.userData.place.slug : null,
        globeHitCount: globeHits.length,
        globeDistance: globeHits.length ? globeHits[0].distance : null,
        wouldBeOccluded: markerHits.length && globeHits.length ? globeHits[0].distance < markerHits[0].distance - 0.01 : null,
      };
    },
  };
}

main();
