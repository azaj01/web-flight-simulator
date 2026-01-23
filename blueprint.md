# 🛩️ Web Flight Simulator Blueprint (JS Only)

## 1. Tujuan Proyek

Membangun game flight simulator berbasis web browser dengan fitur: -
Dunia 3D real-world (terrain) - Kontrol pesawat menggunakan keyboard/mouse - Gaya permainan arcade (Ace Combat 7) - Full JavaScript (tanpa backend wajib)

------------------------------------------------------------------------

## 2. Teknologi Utama

### 2.1 Rendering & Dunia

-   **CesiumJS**
    -   3D globe + terrain real-world
    -   Terrain provider:
        -   Cesium World Terrain (default)
        -   Alternatif: Mapbox Terrain / OpenTopography
-   **Three.js**
    -   Model pesawat (GLTF)
    -   HUD & overlay UI (Ace Combat style)
    -   Animasi & lighting

### 2.2 Kontrol

-   **Keyboard Controls**
    -   W/S/Shift/Ctrl untuk Throttle
    -   Arrow Keys untuk Pitch & Roll
    -   A/D untuk Yaw

### 2.3 Physics

-   Custom lightweight physics loop
-   Opsional:
    -   cannon-es
    -   ammo.js (jika mau collision kompleks)

------------------------------------------------------------------------

## 3. Struktur Folder Project

    /web-flight-simulator
    │
    ├── /public
    │   ├── index.html
    │   ├── /assets
    │   │   ├── plane.glb
    │   │   ├── skybox/
    │   │   └── hud/
    │
    ├── /src
    │   ├── main.js
    │   ├── config.js
    │
    │   ├── /world
    │   │   ├── cesiumWorld.js
    │   │   └── cameraController.js
    │
    │   ├── /plane
    │   │   ├── planeModel.js
    │   │   ├── planePhysics.js
    │   │   └── planeController.js
    │
    │   ├── /input
    │   │   ├── handTracker.js
    │   │   ├── gestureMapper.js
    │   │   └── smoothing.js
    │
    │   ├── /ui
    │   │   ├── hud.js
    │   │   └── debugOverlay.js
    │
    │   └── /utils
    │       ├── math.js
    │       ├── filters.js
    │       └── constants.js
    │
    └── package.json

------------------------------------------------------------------------

## 4. Alur Sistem

    [ Webcam ]
        ↓
    MediaPipe Hands
        ↓
    gestureMapper.js
        ↓
    planeController.js
        ↓
    planePhysics.js
        ↓
    Three.js Model Update
        ↓
    Cesium Camera Sync

------------------------------------------------------------------------

## 5. Mapping Gesture → Kontrol Pesawat

  Gesture / Data Tangan      Kontrol Pesawat
  -------------------------- -----------------
  Tangan miring kiri/kanan   Roll
  Tangan naik/turun          Pitch
  Rotasi telapak tangan      Yaw
  Kepalan tangan             Throttle +
  Telapak terbuka            Throttle -
  Jarak tangan ke kamera     Zoom / Speed

------------------------------------------------------------------------

## 6. Formula Physics Sederhana

``` js
function updatePlane(dt) {
  velocity += throttle * enginePower * dt;
  velocity -= drag * velocity * dt;

  pitchAngle += pitch * pitchRate * dt;
  rollAngle  += roll  * rollRate  * dt;
  yawAngle   += yaw   * yawRate   * dt;

  const lift = velocity * velocity * liftFactor;
  position.y += lift * dt;

  position += forwardVector * velocity * dt;
}
```

------------------------------------------------------------------------

## 7. Setup Dunia 3D (CesiumJS)

``` js
const viewer = new Cesium.Viewer("cesiumContainer", {
  terrainProvider: Cesium.createWorldTerrain(),
  timeline: false,
  animation: false
});

export function setCameraToPlane(pos, heading, pitch, roll) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      pos.lon, pos.lat, pos.alt
    ),
    orientation: { heading, pitch, roll }
  });
}
```

------------------------------------------------------------------------

## 8. Integrasi MediaPipe Hands

``` js
const hands = new Hands({
  locateFile: file =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults(results => {
  if (results.multiHandLandmarks.length > 0) {
    processHand(results.multiHandLandmarks[0]);
  }
});
```

------------------------------------------------------------------------

## 9. Smoothing Input (Anti Jitter)

``` js
export function lowPassFilter(prev, current, alpha = 0.2) {
  return prev + alpha * (current - prev);
}
```

------------------------------------------------------------------------

## 10. Roadmap Pengembangan

### Phase 1 -- MVP

-   Cesium globe + terrain
-   Load model pesawat
-   Keyboard control
-   Kamera follow pesawat

### Phase 2 -- Hand Control

-   MediaPipe Hands
-   Gesture mapping
-   Input smoothing
-   Debug overlay tangan

### Phase 3 -- Physics & UX

-   Lift + drag model
-   HUD speed/altitude
-   Dead zone & kalibrasi

### Phase 4 -- Polish

-   Sound engine
-   Clouds / weather
-   Mobile support (optional)
-   Replay mode

------------------------------------------------------------------------

## 11. Catatan Legal & Teknis

❌ Dilarang: - Mengambil atau merender ulang 3D tiles Google Earth

✅ Disarankan: - Cesium World Terrain - Mapbox Terrain - OpenStreetMap
data

⚠️ Performa: - Batasi draw distance - MediaPipe max 20 FPS - Gunakan LOD
untuk model pesawat

------------------------------------------------------------------------

## 12. Target Minimum Spesifikasi

  Komponen     Minimum
  ------------ -------------
  Browser      Chrome 110+
  GPU          WebGL 2.0
  RAM          8 GB
  Webcam       720p
  FPS Target   30 FPS

------------------------------------------------------------------------

## 13. Output Akhir yang Diharapkan

-   Flight simulator playable di browser
-   Kontrol natural via tangan
-   Dunia real-world (legal)
-   Smooth minimal 30 FPS
-   Modular codebase (mudah dikembangkan)
