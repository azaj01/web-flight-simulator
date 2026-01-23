import * as THREE from 'three';
import { initCesium, setCameraToPlane } from './world/cesiumWorld';
import { PlanePhysics } from './plane/planePhysics';
import { PlaneController } from './plane/planeController';
import { movePosition } from './utils/math';
import { HUD } from './ui/hud';

// Flight State
let state = {
	lon: 106.8272,
	lat: -6.1754,
	alt: 500,
	heading: 0,
	pitch: 0,
	roll: 0,
	speed: 0,
	throttle: 0
};

let scene, camera, renderer;
let planeModel;
let physics = new PlanePhysics();
let controller = new PlaneController();
let hud = new HUD();

function initThree() {
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	document.getElementById('threeContainer').appendChild(renderer.domElement);

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambientLight);
	const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
	directionalLight.position.set(5, 5, 5);
	scene.add(directionalLight);

	const geometry = new THREE.BoxGeometry(1, 0.2, 2);
	const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
	planeModel = new THREE.Mesh(geometry, material);
	scene.add(planeModel);

	planeModel.position.z = -5;
	planeModel.position.y = -1;
}

function update(dt) {
	const input = controller.update();
	const physicsResult = physics.update(input, dt);

	state.speed = physicsResult.speed;
	state.pitch = physicsResult.pitch;
	state.roll = physicsResult.roll;
	state.heading = physicsResult.heading;

	const newPos = movePosition(state.lon, state.lat, state.alt, state.heading, state.pitch, state.speed * dt);
	state.lon = newPos.lon;
	state.lat = newPos.lat;
	state.alt = newPos.alt;

	// New HUD Update
	hud.update(state);

	setCameraToPlane(state.lon, state.lat, state.alt, state.heading, state.pitch, state.roll);

	if (planeModel) {
		planeModel.rotation.z = THREE.MathUtils.degToRad(-state.roll);
		planeModel.rotation.x = THREE.MathUtils.degToRad(state.pitch);
	}
}

function animate() {
	requestAnimationFrame(animate);
	update(0.016);
	renderer.render(scene, camera);
}

initCesium();
initThree();
animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
