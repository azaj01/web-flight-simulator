import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initCesium, setCameraToPlane, getViewer } from './world/cesiumWorld';
import { PlanePhysics } from './plane/planePhysics';
import { PlaneController } from './plane/planeController';
import { movePosition } from './utils/math';
import { HUD } from './ui/hud';
import * as Cesium from 'cesium';

// Game States
const States = {
	MENU: 'MENU',
	PICK_SPAWN: 'PICK_SPAWN',
	TRANSITIONING: 'TRANSITIONING',
	FLYING: 'FLYING',
	PAUSED: 'PAUSED',
	CRASHED: 'CRASHED'
};

let currentState = States.MENU;

// Flight State
let state = {
	lon: 106.8272,
	lat: -6.1754,
	alt: 1000,
	heading: 0,
	pitch: 0,
	roll: 0,
	speed: 0,
	throttle: 0
};

let scene, camera, renderer;
let planeModel;
let mixer, clock;
let physics = new PlanePhysics();
let controller = new PlaneController();
let hud = new HUD();

// Visual Inertia Constants
const BASE_PLANE_POS = new THREE.Vector3(0, -0.8, -3.2);
let visualOffset = new THREE.Vector3().copy(BASE_PLANE_POS);
let visualRotation = new THREE.Euler(0, 0, 0);
let lastSpeed = 0;

// DOM Elements
const mainMenu = document.getElementById('mainMenu');
const pauseMenu = document.getElementById('pauseMenu');
const crashMenu = document.getElementById('crashMenu');
const uiContainer = document.getElementById('uiContainer');
const threeContainer = document.getElementById('threeContainer');
const spawnInstruction = document.getElementById('spawnInstruction');
const confirmSpawnBtn = document.getElementById('confirmSpawnBtn');

let spawnMarker = null;

function initThree() {
	clock = new THREE.Clock();
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setClearColor(0x000000, 0); // Ensure full transparency
	threeContainer.appendChild(renderer.domElement);
	
	threeContainer.classList.add('hidden'); // Start hidden

	const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
	directionalLight.position.set(5, 10, 5);
	scene.add(directionalLight);

	const loader = new GLTFLoader();
	loader.load('/assets/models/low_poly_f-15.glb', (gltf) => {
		const mesh = gltf.scene;
		
		// Create a wrapper group to fix orientation
		planeModel = new THREE.Group();
		planeModel.add(mesh);
		scene.add(planeModel);

		// Fix the model's internal rotation (it was facing sideways)
		// Most GLB models face +Z (backwards) or +X (sideways)
		// Based on the screenshot, it was facing the camera (+Z).
		// We rotate it to face away from the camera (-Z).
		mesh.rotation.y = Math.PI / 2; 
		
		// Position relative to camera (Chase View)
		planeModel.position.copy(BASE_PLANE_POS);
		planeModel.scale.set(0.2, 0.2, 0.2); 
		
		// Setup Animation - Using static pose 'F15 ldg'
		mixer = new THREE.AnimationMixer(mesh);
		const clip = THREE.AnimationClip.findByName(gltf.animations, 'F15 ldg');
		if (clip) {
			const action = mixer.clipAction(clip);
			action.setLoop(THREE.LoopOnce);
			action.clampWhenFinished = true;
			action.play();
		}
	}, undefined, (error) => {
		console.error('Error loading model:', error);
	});
}

function update(dt) {
	if (currentState !== States.FLYING) return;

	const input = controller.update();
	const physicsResult = physics.update(input, dt);

	const prevSpeed = state.speed;
	state.speed = physicsResult.speed;
	state.pitch = physicsResult.pitch;
	state.roll = physicsResult.roll;
	state.heading = physicsResult.heading;
	state.throttle = input.throttle;
	state.yaw = input.yaw;

	const newPos = movePosition(state.lon, state.lat, state.alt, state.heading, state.pitch, state.speed * dt);
	state.lon = newPos.lon;
	state.lat = newPos.lat;
	state.alt = newPos.alt;

	// Check for crash
	checkCrash();

	// New HUD Update
	hud.update(state);

	setCameraToPlane(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);

	if (planeModel) {
		// --- INERTIA EFFECTS ---
		// 1. Longitudinal (Speed/Accel)
		const accel = (state.speed - prevSpeed) / dt;
		// Forward offset (away from camera) on acceleration, backward on braking
		const targetZ = BASE_PLANE_POS.z - (accel * 0.001); 
		
		// 2. Lateral/Vertical (Pitch/Roll/Yaw)
		// Model shifts slightly in frame when maneuvering
		const targetX = BASE_PLANE_POS.x - (input.roll * 0.6) - (input.yaw * 0.12);
		const targetY = BASE_PLANE_POS.y - (input.pitch * 0.1);
		
		// 3. Rotation Lag
		const targetRotZ = THREE.MathUtils.degToRad(-input.roll * 15);
		const targetRotX = THREE.MathUtils.degToRad(input.pitch * 10);
		const targetRotY = THREE.MathUtils.degToRad(-input.yaw * 4);

		// Smooth transition (Spring-like lerp)
		const lerpFactor = 5.0 * dt;
		visualOffset.x += (targetX - visualOffset.x) * lerpFactor;
		visualOffset.y += (targetY - visualOffset.y) * lerpFactor;
		visualOffset.z += (targetZ - visualOffset.z) * lerpFactor;
		
		visualRotation.z += (targetRotZ - visualRotation.z) * lerpFactor;
		visualRotation.x += (targetRotX - visualRotation.x) * lerpFactor;
		visualRotation.y += (targetRotY - visualRotation.y) * lerpFactor;

		planeModel.position.copy(visualOffset);
		planeModel.rotation.set(visualRotation.x, visualRotation.y, visualRotation.z);
	}
}

let lastCrashCheck = 0;
let flightStartTime = 0;

function checkCrash() {
	if (currentState !== States.FLYING) return;
	
	const now = Date.now();
	if (now - lastCrashCheck < 100) return; // Only check 10 times per second
	lastCrashCheck = now;

	// Grace period: ignore crashes for first 3 seconds to allow terrain to load
	if (now - flightStartTime < 3000) return;

	const viewer = getViewer();
	if (!viewer) return;

	const cartographic = Cesium.Cartographic.fromDegrees(state.lon, state.lat);
	const terrainHeight = viewer.scene.globe.getHeight(cartographic);

	if (terrainHeight !== undefined && state.alt <= terrainHeight + 5) {
		currentState = States.CRASHED;
		uiContainer.classList.add('hidden');
		threeContainer.classList.add('hidden');
		crashMenu.classList.remove('hidden');
	}
}

function animate() {
	requestAnimationFrame(animate);
	
	const dt = clock ? clock.getDelta() : 0.016;

	if (currentState === States.FLYING || currentState === States.PAUSED || currentState === States.TRANSITIONING) {
		if (currentState === States.FLYING) {
			update(dt);
		}
		
		if (mixer) mixer.update(dt);
		
		// Plane is rendered, but update() is only called in FLYING state
		// During TRANSITIONING, camera is moved by Cesium flyTo
		renderer.render(scene, camera);
	} else {
		threeContainer.classList.add('hidden');
	}
}

// UI Handlers
document.getElementById('startBtn').onclick = () => {
	mainMenu.classList.add('hidden');
	enterSpawnPicking();
};

document.getElementById('optionsBtn').onclick = () => {
	alert('Options: \n- Controls: WASD/Arrows\n- Camera: Follow\n- Sensitivity: 1.0\n(Work in Progress)');
};

document.getElementById('resumeBtn').onclick = () => {
	pauseMenu.classList.add('hidden');
	uiContainer.classList.remove('hidden');
	currentState = States.FLYING;
};

document.getElementById('restartBtn').onclick = () => {
	pauseMenu.classList.add('hidden');
	enterSpawnPicking();
};

document.getElementById('quitBtn').onclick = () => {
	location.reload();
};

document.getElementById('respawnBtn').onclick = () => {
	crashMenu.classList.add('hidden');
	enterSpawnPicking();
};

function enterSpawnPicking() {
	spawnInstruction.classList.remove('hidden');
	threeContainer.classList.add('hidden');
	uiContainer.classList.add('hidden');
	currentState = States.PICK_SPAWN;
	confirmSpawnBtn.classList.add('hidden');
	
	if (spawnMarker) {
		const viewer = getViewer();
		viewer.entities.remove(spawnMarker);
		spawnMarker = null;
	}

	const viewer = getViewer();
	viewer.camera.flyTo({
		destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, 15000),
		duration: 1.5
	});
}

// Spawn logic
function setupSpawnPicker() {
	const viewer = getViewer();
	const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
	
	handler.setInputAction((click) => {
		if (currentState !== States.PICK_SPAWN) return;
		
		const ray = viewer.camera.getPickRay(click.position);
		const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
		
		if (cartesian) {
			const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
			const lon = Cesium.Math.toDegrees(cartographic.longitude);
			const lat = Cesium.Math.toDegrees(cartographic.latitude);
			
			// Ensure terrain height is at least sea level (0) for safety
			const terrainHeight = Math.max(0, cartographic.height);
			
			// Update pending state
			state.lon = lon;
			state.lat = lat;
			state.alt = terrainHeight + 1500; // Start at ~5000ft (1500m) for breathing room
			
			// Visual marker
			if (spawnMarker) {
				viewer.entities.remove(spawnMarker);
			}
			spawnMarker = viewer.entities.add({
				position: cartesian,
				point: {
					pixelSize: 15,
					color: Cesium.Color.RED,
					outlineColor: Cesium.Color.WHITE,
					outlineWidth: 2,
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				},
				label: {
					text: "Target Spawn Location",
					font: "14pt AceCombat",
					style: Cesium.LabelStyle.FILL_AND_OUTLINE,
					outlineWidth: 2,
					verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
					pixelOffset: new Cesium.Cartesian2(0, -20),
					disableDepthTestDistance: Number.POSITIVE_INFINITY
				}
			});

			confirmSpawnBtn.classList.remove('hidden');
		}
	}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

document.getElementById('confirmSpawnBtn').onclick = () => {
	const viewer = getViewer();
	if (spawnMarker) {
		viewer.entities.remove(spawnMarker);
		spawnMarker = null;
	}

	state.speed = 150;
	state.pitch = 0;
	state.roll = 0;
	state.heading = 0;
	
	// Reset physics and set initial orientation
	physics = new PlanePhysics();
	physics.reset(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);
	
	hud.resetTime();
	hud.resizeMinimap(); 
	
	spawnInstruction.classList.add('hidden');
	confirmSpawnBtn.classList.add('hidden');
	
	currentState = States.TRANSITIONING;

	// Beautiful fly-in transition to cockpit
	viewer.camera.flyTo({
		destination: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt),
		orientation: {
			heading: Cesium.Math.toRadians(state.heading),
			pitch: Cesium.Math.toRadians(state.pitch),
			roll: Cesium.Math.toRadians(state.roll)
		},
		duration: 2.0,
		easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
		complete: () => {
			flightStartTime = Date.now();
			uiContainer.classList.remove('hidden');
			threeContainer.classList.remove('hidden');
			hud.resizeMinimap();
			currentState = States.FLYING;
		}
	});

	// Minor delay to show threeContainer slightly before flight starts so it blends
	setTimeout(() => {
		if (currentState === States.TRANSITIONING) {
			threeContainer.classList.remove('hidden');
		}
	}, 1500);
};

// Keyboard for Pause
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
		if (currentState === States.FLYING) {
			currentState = States.PAUSED;
			uiContainer.classList.add('hidden');
			pauseMenu.classList.remove('hidden');
		} else if (currentState === States.PAUSED) {
			currentState = States.FLYING;
			pauseMenu.classList.add('hidden');
			uiContainer.classList.remove('hidden');
		}
	}
});

const viewer = initCesium();
initThree();
setupSpawnPicker();

// Ensure everything is hidden at start
uiContainer.classList.add('hidden');
threeContainer.classList.add('hidden');

animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
