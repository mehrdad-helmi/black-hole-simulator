import { GUI } from 'lil-gui';
import * as THREE from 'three';
import { Uniform } from 'three';

import starURL from './assets/star.png';
import fullscreenVert from './shaders/fullscreen.vert';
import rayFrag from './shaders/raytrace.frag';

// renderer

const canvas = document.getElementById('gl')! as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', {
	antialias: true,
	alpha: false,
	powerPreference: 'high-performance',
	desynchronized: true,
	preserveDrawingBuffer: false,
});
if (!gl) throw new Error('WebGL2 not available; browser/GPU fell back to WebGL1.');

const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.Camera();

// star texture
const starTex = new THREE.TextureLoader().load(starURL);
starTex.colorSpace = THREE.SRGBColorSpace;
starTex.minFilter = THREE.LinearMipMapLinearFilter;
starTex.magFilter = THREE.LinearFilter;
starTex.wrapS = starTex.wrapT = THREE.RepeatWrapping;

// params
const params = {
	fovYdeg: 65,
	observerR: 40.0, // ↑ move camera farther
	massM: 1.0, // M
	// caps + perf
	lambdaMax: 40.0,
	maxSteps: 256,
	rMax: 2000.0,
	rHorizonEps: 0.01,
	// adaptive
	hMin: 0.03,
	hMax: 0.9,
	strongWidth: 8.0,
	curvEps: 2e-4,
	asymR: 40.0,
	asymDrdl: 0.02,
	// disk
	diskOn: true,
	diskRin: 6.0,
	diskRout: 50.0,
	diskQ: 3.0,
	diskColInner: '#ffddaa',
	diskColOuter: '#8844ff',
	diskChecker: false,
	checkSize: 4.0,
	// post
	exposure: 1.2,
	// wobble
	wobble: false,
	wobbleDeg: 2.0,
	wobbleHz: 0.2,
	// render scale
	renderScale: 1.0,
	inclDeg: 60.0, // NEW: inclination (0 = on +Z axis, 90 = edge-on)
	azDeg: 0,
	diskI0: 8.0,

	hotOn: true,
	hotR: 12.0,
	hotAmp: 2.0,
	hotSigmaR: 1.5,
	hotSigmaPhi: 0.25, // radians (~14°)

	planeTight: 2.0, // [M] shrink step when |z| < this
	zRefine: 5,
};

// uniforms
const uniforms = {
	uResolution: new Uniform(new THREE.Vector2(window.innerWidth, window.innerHeight)),
	uInvProj: new Uniform(new THREE.Matrix4()),
	uInvView: new Uniform(new THREE.Matrix4()),
	uCamPos: new Uniform(new THREE.Vector3()),
	uStarTex: new Uniform(starTex),
	uTime: new Uniform(0.0),
	uExposure: new Uniform(params.exposure),

	uMaxSteps: new Uniform(params.maxSteps),
	uLambdaMax: new Uniform(params.lambdaMax),

	uMassM: new Uniform(params.massM),
	uRMax: new Uniform(params.rMax),
	uRHorizonEps: new Uniform(params.rHorizonEps),

	uHMin: new Uniform(params.hMin),
	uHMax: new Uniform(params.hMax),
	uStrongWidth: new Uniform(params.strongWidth),
	uCurvEps: new Uniform(params.curvEps),
	uAsymR: new Uniform(params.asymR),
	uAsymDrdl: new Uniform(params.asymDrdl),

	uDiskOn: new Uniform(params.diskOn ? 1 : 0),
	uDiskRin: new Uniform(params.diskRin),
	uDiskRout: new Uniform(params.diskRout),
	uDiskQ: new Uniform(params.diskQ),
	uDiskColInner: new Uniform(new THREE.Color(params.diskColInner).toArray()),
	uDiskColOuter: new Uniform(new THREE.Color(params.diskColOuter).toArray()),
	uDiskChecker: new Uniform(params.diskChecker ? 1 : 0),
	uDiskI0: new Uniform(params.diskI0),
	uCheckSize: new Uniform(params.checkSize),

	uWobbleOn: new Uniform(0),
	uWobbleDeg: new Uniform(params.wobbleDeg),
	uWobbleHz: new Uniform(params.wobbleHz),

	uHotOn: new Uniform(params.hotOn ? 1 : 0),
	uHotR: new Uniform(params.hotR),
	uHotAmp: new Uniform(params.hotAmp),
	uHotSigmaR: new Uniform(params.hotSigmaR),
	uHotSigmaPhi: new Uniform(params.hotSigmaPhi),

	uTanHalfFovX: new Uniform(1.0),
	uTanHalfFovY: new Uniform(1.0),

	uPlaneTight: new Uniform(params.planeTight),
	uZRefine: new Uniform(params.zRefine),
};

// material + fullscreen tri
const material = new THREE.ShaderMaterial({
	vertexShader: fullscreenVert,
	fragmentShader: rayFrag,
	uniforms,
	glslVersion: THREE.GLSL3,
});
const geo = new THREE.BufferGeometry();
geo.setDrawRange(0, 3);
scene.add(new THREE.Mesh(geo, material));

function setShadowSize(fractionOfHeight: number) {
	// fractionOfHeight in (0, 0.9), e.g., 0.25 => 25% of screen height
	const fovY = THREE.MathUtils.degToRad(params.fovYdeg);
	const t = Math.tan(fovY / 2);
	const y = Math.max(0.02, Math.min(0.9, fractionOfHeight));
	// screen mapping: y = tan(theta) / tan(FOVy/2)  =>  tan(theta) = y * t
	const theta = Math.atan(y * t); // radians
	const R = (3 * Math.sqrt(3) * params.massM) / theta; // R that gives desired shadow size
	params.observerR = R;
	updateCamera();
}

// camera matrices (camera at (0,0,observerR) looking to origin)
function updateCamera() {
	const fovY = THREE.MathUtils.degToRad(params.fovYdeg);
	const aspect = window.innerWidth / window.innerHeight;

	// projection (still fine to keep, but not needed for rays anymore)
	const near = 0.1,
		far = 100.0;
	const top = near * Math.tan(fovY / 2);
	const bottom = -top;
	const left = -top * aspect;
	const right = top * aspect;
	const proj = new THREE.Matrix4().makePerspective(left, right, top, bottom, near, far);

	const th = THREE.MathUtils.degToRad(params.inclDeg);
	const ph = THREE.MathUtils.degToRad(params.azDeg);
	const R = params.observerR;

	const camPos = new THREE.Vector3(
		R * Math.sin(th) * Math.cos(ph),
		R * Math.sin(th) * Math.sin(ph),
		R * Math.cos(th),
	);

	const up =
		Math.abs(Math.cos(th)) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
	const view = new THREE.Matrix4().lookAt(camPos, new THREE.Vector3(0, 0, 0), up);

	uniforms.uInvProj.value.copy(proj).invert();
	uniforms.uInvView.value.copy(view).invert();
	uniforms.uCamPos.value.copy(camPos);

	// NEW: tangents for ray build
	const tanHalfY = Math.tan(fovY / 2);
	const tanHalfX = tanHalfY * aspect;
	uniforms.uTanHalfFovX.value = tanHalfX;
	uniforms.uTanHalfFovY.value = tanHalfY;
}
updateCamera();

// GUI
const gui = new GUI();
gui.add(uniforms.uExposure, 'value', 0.1, 4.0, 0.01).name('exposure');

const fInt = gui.addFolder('Integrator');
fInt.add(uniforms.uMaxSteps, 'value', 64, 4096, 32).name('max steps');
fInt.add(uniforms.uLambdaMax, 'value', 10.0, 400.0, 1.0).name('λ max');

const fAdapt = gui.addFolder('Adaptive step');
fAdapt.add(uniforms.uHMin, 'value', 0.005, 0.2, 0.005).name('h min (near)');
fAdapt.add(uniforms.uHMax, 'value', 0.2, 2.0, 0.01).name('h max (far)');
fAdapt.add(uniforms.uStrongWidth, 'value', 2.0, 30.0, 0.1).name('strong width [M]');
fAdapt.add(uniforms.uAsymR, 'value', 10.0, 200.0, 1.0).name('asym R [M]');
fAdapt.add(uniforms.uAsymDrdl, 'value', 0.0, 0.2, 0.005).name('asym dr/dλ');
fAdapt.add(uniforms.uCurvEps, 'value', 1e-6, 1e-3, 1e-6).name('curv eps');
fAdapt.add(uniforms.uPlaneTight, 'value', 0.2, 6.0, 0.1).name('plane tight [M]');
fAdapt.add(uniforms.uZRefine, 'value', 0, 8, 1).name('z-refine iters');

const fPhys = gui.addFolder('Schwarzschild');
fPhys
	.add(uniforms.uMassM, 'value', 0.5, 5.0, 0.01)
	.name('mass M')
	.onChange((v) => {
		// If Rin was default ISCO (6M), keep it tracking M — simple heuristic:
		if (Math.abs(uniforms.uDiskRin.value - 6.0 * params.massM) < 1e-6) {
			uniforms.uDiskRin.value = 6.0 * v;
		}
		params.massM = v;
	});
fPhys.add(uniforms.uRMax, 'value', 50.0, 5000.0, 10.0).name('R escape');
fPhys.add(uniforms.uRHorizonEps, 'value', 0.0, 0.1, 0.001).name('horizon eps');

const fDisk = gui.addFolder('Thin disk (z=0)');
fDisk
	.add({ on: params.diskOn }, 'on')
	.name('enabled')
	.onChange((v) => (uniforms.uDiskOn.value = v ? 1 : 0));
fDisk.add(uniforms.uDiskRin, 'value', 2.1, 100.0, 0.1).name('R_in [M]');
fDisk.add(uniforms.uDiskRout, 'value', 10.0, 400.0, 0.5).name('R_out [M]');
fDisk.add(uniforms.uDiskQ, 'value', 0.0, 5.0, 0.1).name('emissivity q');
fDisk
	.addColor(params, 'diskColInner')
	.name('color inner')
	.onChange((v) => {
		const c = new THREE.Color(v);
		uniforms.uDiskColInner.value[0] = c.r;
		uniforms.uDiskColInner.value[1] = c.g;
		uniforms.uDiskColInner.value[2] = c.b;
	});
fDisk
	.addColor(params, 'diskColOuter')
	.name('color outer')
	.onChange((v) => {
		const c = new THREE.Color(v);
		uniforms.uDiskColOuter.value[0] = c.r;
		uniforms.uDiskColOuter.value[1] = c.g;
		uniforms.uDiskColOuter.value[2] = c.b;
	});
fDisk
	.add({ checker: params.diskChecker }, 'checker')
	.name('debug checker')
	.onChange((v) => (uniforms.uDiskChecker.value = v ? 1 : 0));
fDisk.add(uniforms.uCheckSize, 'value', 0.5, 20.0, 0.5).name('checker size [M]');
fDisk.add(uniforms.uDiskI0, 'value', 0.0, 20.0, 0.1).name('intensity I0');

const fCam = gui.addFolder('Camera');
fCam
	.add(params, 'observerR', 6.0, 400.0, 0.5)
	.name('observer R (M)')
	.onChange(updateCamera)
	.listen();
fCam.add(params, 'fovYdeg', 30, 100, 1).name('FOV Y').onChange(updateCamera);
fCam.add(params, 'inclDeg', 0, 89, 1).name('inclination').onChange(updateCamera);
fCam.add(params, 'azDeg', -180, 180, 1).name('azimuth').onChange(updateCamera);

gui.add({ frame20: () => setShadowSize(0.22) }, 'frame20').name('Frame BH (22% H)');
gui.add({ frame35: () => setShadowSize(0.35) }, 'frame35').name('Frame BH (35% H)');

const fHot = gui.addFolder('Hotspot');
fHot
	.add({ on: params.hotOn }, 'on')
	.name('enabled')
	.onChange((v) => (uniforms.uHotOn.value = v ? 1 : 0));
fHot.add(uniforms.uHotR, 'value', 6.0, 80.0, 0.1).name('R0 [M]');
fHot.add(uniforms.uHotAmp, 'value', 0.0, 5.0, 0.05).name('amplitude');
fHot.add(uniforms.uHotSigmaR, 'value', 0.2, 5.0, 0.1).name('σ_r [M]');
fHot.add(uniforms.uHotSigmaPhi, 'value', 0.05, 1.0, 0.01).name('σ_φ [rad]');

// render scale
const baseDPR = Math.min(window.devicePixelRatio, 2);
gui
	.add(params, 'renderScale', 0.5, 1, 0.01)
	.name('render scale')
	.onChange((v) => renderer.setPixelRatio(baseDPR * v));

// wobble
const wob = { on: false };
gui
	.add(wob, 'on')
	.name('debug wobble')
	.onChange((v) => (uniforms.uWobbleOn.value = v ? 1 : 0));
const fW = gui.addFolder('Wobble');
fW.add(uniforms.uWobbleDeg, 'value', 0.0, 10.0, 0.1).name('degrees');
fW.add(uniforms.uWobbleHz, 'value', 0.01, 5.0, 0.01).name('Hz');

function rhoMaxAtImageEdge(): number {
	const fovY = THREE.MathUtils.degToRad(params.fovYdeg);
	const aspect = window.innerWidth / window.innerHeight;
	const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
	return params.observerR * Math.tan(fovX / 2); // in M
}
// (Optional) print once:
console.log('ρ_max at edge ≈', rhoMaxAtImageEdge().toFixed(2), 'M');

// resize
window.addEventListener('resize', () => {
	const w = window.innerWidth,
		h = window.innerHeight;
	renderer.setSize(w, h);
	uniforms.uResolution.value.set(w, h);
	updateCamera();
});

// animate
const t0 = performance.now();
function tick() {
	uniforms.uTime.value = (performance.now() - t0) / 1000;
	renderer.render(scene, camera);
	requestAnimationFrame(tick);
}
tick();
