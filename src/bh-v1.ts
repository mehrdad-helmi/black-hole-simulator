import { GUI } from 'lil-gui';

// Backgrounds
import hazyNebula1 from './assets/galactic_plane_hazy_nebulae_1.png';
import hazyNebula2 from './assets/galactic_plane_hazy_nebulae_2.png';
import noNebula1 from './assets/galactic_plane_no_nebulae_1.png';
import noNebula2 from './assets/galactic_plane_no_nebulae_2.png';
import multiNebula1 from './assets/rich_multi_nebulae_1.png';
import multiNebula2 from './assets/rich_multi_nebulae_2.png';
import { addVersionFolder, versionNames } from './gui';
import vertSrc from './shaders/v1/fullscreen.vert';
import fragSrc from './shaders/v1/scene.frag';

const backgrounds = [hazyNebula1, hazyNebula2, noNebula1, noNebula2, multiNebula1, multiNebula2];

// ----- WebGL setup -----
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) throw new Error('WebGL2 not supported');

function compile(type: number, src: string) {
	const sh = gl.createShader(type)!;
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		throw new Error(String(gl.getShaderInfoLog(sh)));
	}
	return sh;
}
function makeProgram(vsSrc: string, fsSrc: string) {
	const vs = compile(gl.VERTEX_SHADER, vsSrc);
	const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
	const prog = gl.createProgram()!;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		throw new Error(String(gl.getProgramInfoLog(prog)));
	}
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	return prog;
}
const program = makeProgram(vertSrc, fragSrc);
gl.useProgram(program);

// ----- Uniforms -----
const uResolution = gl.getUniformLocation(program, 'uResolution');
const uTime = gl.getUniformLocation(program, 'uTime');
const uAspect = gl.getUniformLocation(program, 'uAspect');
const uMassM = gl.getUniformLocation(program, 'uMassM');
const uObserverR = gl.getUniformLocation(program, 'uObserverR');
const uExposure = gl.getUniformLocation(program, 'uExposure');
const uGamma = gl.getUniformLocation(program, 'uGamma');
const uUseTex = gl.getUniformLocation(program, 'uUseTex');
const uTex = gl.getUniformLocation(program, 'uTex');
const uQuality = gl.getUniformLocation(program, 'uQuality');
const uFovY = gl.getUniformLocation(program, 'uFovY');
const uCamRot = gl.getUniformLocation(program, 'uCamRot'); // mat3

// ----- GUI params -----
const params = {
	// physics
	massM: 1.0,
	observerR: 8.0, // in M
	quality: 512,

	// display
	exposure: 1.2,
	gamma: 1.0,

	// camera (orbit)
	fovY: 100.0, // vertical FOV in degrees
	azimuth: 0.0, // degrees, 0 = +Z toward BH, orbit around Y-up
	elevation: 0.0, // not coplanar with disk by default
	autoRotateAzimuth: false,
	autoRotateElevation: false,
	rotSpeedDegPerSec: 10.0,

	// mouse drag
	dragSensitivity: 0.35, // deg per pixel
	dollyTarget: 8.0, // target distance
	dollySpeed: 0.5, // lerp factor
	autoDolly: false,

	// background
	useTexture: true,
	bg: backgrounds[0],
};
const derived = { thetaShadowDeg: 0.0 };

const gui = new GUI();
gui.title(versionNames.schwarzschild);
const fPhys = gui.addFolder('Physics');
fPhys.add(params, 'massM', 0.2, 5.0, 0.1).name('Mass M');
fPhys.add(params, 'observerR', 5.0, 60.0, 1.0).name('Observer r (M)').listen();
fPhys.add(params, 'quality', 32, 1024, 4).name('Integration steps');

const fCam = gui.addFolder('Camera');
fCam.add(params, 'fovY', 30, 140, 1).name('FOV (deg)');
fCam.add(params, 'azimuth', -180, 180, 1).name('Orbit azimuth').listen();
fCam.add(params, 'autoRotateAzimuth').name('Auto-rotate Azimuth');
fCam.add(params, 'elevation', -89, 89, 1).name('Orbit elevation').listen();
fCam.add(params, 'autoRotateElevation').name('Auto-rotate Elevation');
fCam.add(params, 'rotSpeedDegPerSec', 1, 60, 1).name('Rotate speed');
fCam.add(params, 'autoDolly').name('Auto dolly zoom');
fCam.add(params, 'dollyTarget', 5, 60, 1).name('Dolly target (M)');
fCam.add(params, 'dollySpeed', 0.1, 5.0, 0.1).name('Dolly speed');
fCam.add(params, 'dragSensitivity', 0.1, 1.0, 0.05).name('Drag sens');

const fDisp = gui.addFolder('Display');
fDisp.add(params, 'exposure', 0.2, 3.0, 0.05).name('Exposure');
fDisp.add(params, 'gamma', 0.6, 2.2, 0.01).name('Gamma');
fDisp.add(params, 'useTexture').name('Use sky texture');
fDisp
	.add(params, 'bg', backgrounds)
	.name('Background')
	.onChange((bg: string) => {
		const img = new Image();
		img.src = bg;
		img.onload = () => {
			skyTex = makeTexture(img);
		};
	});
gui.add(derived, 'thetaShadowDeg').name('Shadow θ (deg)').listen();

addVersionFolder(gui);

// ----- Texture -----
function makeTexture(image: HTMLImageElement) {
	const tex = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
	gl.generateMipmap(gl.TEXTURE_2D);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return tex;
}
let skyTex: WebGLTexture | null = null;
{
	const img = new Image();
	img.src = backgrounds[0];
	img.onload = () => {
		skyTex = makeTexture(img);
	};
}

// ----- Mouse drag orbit -----
let isDragging = false;
let lastX = 0,
	lastY = 0;
canvas.addEventListener('mousedown', (e) => {
	isDragging = true;
	lastX = e.clientX;
	lastY = e.clientY;
});
['mouseup', 'mouseleave'].forEach((ev) =>
	canvas.addEventListener(ev, () => {
		isDragging = false;
	}),
);
canvas.addEventListener('mousemove', (e) => {
	if (!isDragging) return;
	const dx = e.clientX - lastX;
	const dy = e.clientY - lastY;
	lastX = e.clientX;
	lastY = e.clientY;
	params.azimuth += dx * params.dragSensitivity;
	params.elevation -= dy * params.dragSensitivity;
	if (params.elevation > 89) params.elevation = 89;
	if (params.elevation < -89) params.elevation = -89;
});

// ----- Resize & draw -----
function resizeCanvas() {
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const w = Math.floor(canvas.clientWidth * dpr);
	const h = Math.floor(canvas.clientHeight * dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	gl.viewport(0, 0, canvas.width, canvas.height);
}
const deg2rad = (d: number) => (d * Math.PI) / 180;

// build a look-at rotation that faces the BH at the origin from an orbital position.
// We only need the rotation matrix (no translation for the shader).
function orbitRotationMatrix(azDeg: number, elDeg: number) {
	const az = deg2rad(azDeg);
	const el = deg2rad(elDeg);
	// Camera position on sphere r=1 (direction only)
	const cosEl = Math.cos(el),
		sinEl = Math.sin(el);
	const cosAz = Math.cos(az),
		sinAz = Math.sin(az);
	// Position in world (unit sphere)
	const px = cosEl * sinAz; // choose +Z forward convention
	const py = sinEl;
	const pz = cosEl * cosAz;

	// Forward points from camera to BH at origin = -pos
	const fx = -px,
		fy = -py,
		fz = -pz;
	const fLen = Math.hypot(fx, fy, fz);
	const fxn = fx / fLen,
		fyn = fy / fLen,
		fzn = fz / fLen;

	// World up (approx). If near poles, this is fine for UI; avoids gimbal lock for el≠±90
	const upx = 0,
		upy = 1,
		upz = 0;

	// Right = up × forward
	let rx = upy * fzn - upz * fyn;
	let ry = upz * fxn - upx * fzn;
	let rz = upx * fyn - upy * fxn;
	const rLen = Math.hypot(rx, ry, rz) || 1;
	rx /= rLen;
	ry /= rLen;
	rz /= rLen;

	// True up = forward × right
	const ux = fyn * rz - fzn * ry;
	const uy = fzn * rx - fxn * rz;
	const uz = fxn * ry - fyn * rx;

	// Columns = [right, up, forward]
	return new Float32Array([rx, ux, fxn, ry, uy, fyn, rz, uz, fzn]);
}

let lastMs = 0;
function frame(tMs: number) {
	const dt = (tMs - lastMs) * 0.001;
	lastMs = tMs;
	resizeCanvas();

	// Angular shadow radius for display
	const bc = 3 * Math.sqrt(3) * params.massM;
	derived.thetaShadowDeg = (Math.atan(bc / params.observerR) * 180) / Math.PI;

	if (params.autoRotateAzimuth) {
		params.azimuth += params.rotSpeedDegPerSec * dt;
		if (params.azimuth > 180) params.azimuth -= 360;
		else if (params.azimuth < -180) params.azimuth += 360;
	}

	if (params.autoRotateElevation) {
		params.elevation += params.rotSpeedDegPerSec * dt;
		if (params.elevation > 89) params.elevation -= 178;
		else if (params.elevation < -89) params.elevation += 178;
	}

	// Smooth dolly towards target
	if (params.autoDolly)
		params.observerR += (params.dollyTarget - params.observerR) * params.dollySpeed * dt;

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.uniform2f(uResolution, canvas.width, canvas.height);
	gl.uniform1f(uTime, tMs * 0.001);
	gl.uniform1f(uAspect, canvas.width / canvas.height);
	gl.uniform1f(uMassM, params.massM);
	gl.uniform1f(uObserverR, params.observerR);
	gl.uniform1f(uExposure, params.exposure);
	gl.uniform1f(uGamma, params.gamma);
	gl.uniform1i(uUseTex, params.useTexture ? 1 : 0);
	gl.uniform1i(uQuality, params.quality);
	gl.uniform1f(uFovY, deg2rad(params.fovY));

	// Orbit camera -> rotation matrix
	const rot = orbitRotationMatrix(params.azimuth, params.elevation);
	gl.uniformMatrix3fv(uCamRot, false, rot);

	if (skyTex) {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, skyTex);
		gl.uniform1i(uTex, 0);
	}

	gl.drawArrays(gl.TRIANGLES, 0, 3);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
