import * as Cesium from 'cesium';

let viewer;
let miniViewer;

export function initCesium() {
	viewer = new Cesium.Viewer("cesiumContainer", {
		terrain: Cesium.Terrain.fromWorldTerrain(),
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false,
	});

	miniViewer = new Cesium.Viewer("minimapCesium", {
		terrain: null,
		timeline: false,
		animation: false,
		baseLayerPicker: false,
		geocoder: false,
		homeButton: false,
		infoBox: false,
		sceneModePicker: false,
		selectionIndicator: false,
		navigationHelpButton: false,
		fullscreenButton: false,
		shouldAnimate: false,
		skyBox: false,
		skyAtmosphere: false,
		contextOptions: {
			webgl: {
				preserveDrawingBuffer: true
			}
		}
	});

	[viewer, miniViewer].forEach(v => {
		v.scene.requestRenderMode = false;
		v.scene.maximumRenderTimeChange = 0;
		v.scene.globe.maximumScreenSpaceError = 2;
		v.resolutionScale = 0.75;

		v.scene.screenSpaceCameraController.enableRotate = false;
		v.scene.screenSpaceCameraController.enableTranslate = false;
		v.scene.screenSpaceCameraController.enableZoom = false;
		v.scene.screenSpaceCameraController.enableTilt = false;
		v.scene.screenSpaceCameraController.enableLook = false;

		v.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;

		v.scene.globe.tileCacheSize = 2048;
		v.scene.globe.preloadAncestors = true;
		v.scene.globe.preloadSiblings = true;
		v.scene.globe.loadingDescendantLimit = 20;

		v.scene.globe.skipLevelOfDetail = true;
		v.scene.globe.baseScreenSpaceError = 1024;
		v.scene.globe.skipScreenSpaceErrorFactor = 16;
		v.scene.globe.skipLevels = 1;

		v._cesiumWidget._creditContainer.style.display = "none";
	});

	miniViewer.scene.globe.enableLighting = false;
	miniViewer.scene.globe.showGroundAtmosphere = false;
	miniViewer.scene.fog.enabled = false;
	miniViewer.scene.highDynamicRange = false;
	miniViewer.scene.postProcessStages.fxaa.enabled = false;
	miniViewer.resolutionScale = 1.0;
	miniViewer.scene.globe.maximumScreenSpaceError = 2;
	miniViewer.scene.globe.baseColor = Cesium.Color.BLACK;
	if (miniViewer.scene.skyAtmosphere) miniViewer.scene.skyAtmosphere.show = false;

	viewer.scene.globe.enableLighting = true;
	viewer.scene.highDynamicRange = false;
	viewer.scene.postProcessStages.fxaa.enabled = true;
	viewer.scene.skyAtmosphere = new Cesium.SkyAtmosphere();

	viewer.scene.fog.enabled = true;
	viewer.scene.fog.density = 0.0001;

	setControlsEnabled(false);

	return viewer;
}

export function setRenderOptimization(isMenu) {
	if (!viewer || !miniViewer) return;

	[viewer, miniViewer].forEach(v => {
		v.scene.requestRenderMode = !isMenu;
		v.scene.maximumRenderTimeChange = !isMenu ? Infinity : 0;
	});
}

export function setControlsEnabled(enabled) {
	if (!viewer) return;
	const ctrl = viewer.scene.screenSpaceCameraController;
	ctrl.enableRotate = enabled;
	ctrl.enableTranslate = enabled;
	ctrl.enableZoom = enabled;
	ctrl.enableTilt = enabled;
	ctrl.enableLook = enabled;
}

export function setCameraToPlane(lon, lat, alt, heading, pitch, roll) {
	if (!viewer) return;

	viewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(pitch),
			roll: Cesium.Math.toRadians(roll)
		}
	});

	viewer.scene.requestRender();
}

export function setMinimapCamera(lon, lat, altitude, heading) {
	if (!miniViewer) return;

	if (miniViewer.canvas.width === 0 || miniViewer.canvas.height === 0) {
		return;
	}

	miniViewer.camera.setView({
		destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
		orientation: {
			heading: Cesium.Math.toRadians(heading),
			pitch: Cesium.Math.toRadians(-90),
			roll: 0
		}
	});

	miniViewer.scene.requestRender();
}

export function getViewer() {
	return viewer;
}

export function getMiniViewer() {
	return miniViewer;
}
