import { GUI } from 'lil-gui';

// Backgrounds
import hazyNebula1 from './assets/galactic_plane_hazy_nebulae_1.png';
import hazyNebula2 from './assets/galactic_plane_hazy_nebulae_2.png';
import noNebula1 from './assets/galactic_plane_no_nebulae_1.png';
import noNebula2 from './assets/galactic_plane_no_nebulae_2.png';
import multiNebula1 from './assets/rich_multi_nebulae_1.png';
import multiNebula2 from './assets/rich_multi_nebulae_2.png';
import vertSrc from './shaders/fullscreen.vert?raw';
import fragSrc from './shaders/scene.frag?raw';

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
const uScaleM = gl.getUniformLocation(program, 'uScaleM');
const uMassM = gl.getUniformLocation(program, 'uMassM');
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
	scaleM: 8.0,
	massM: 1.0,
	quality: 64,

	// display
	exposure: 1.2,
	gamma: 1.0,

	// camera
	fovY: 100.0,
	yaw: 0.0,
	pitch: 0.0,
	roll: 0.0,

	// background
	useTexture: true,
	bg: backgrounds[0],
};
const derived = { shadowRadiusNDC: 0.0 };

const gui = new GUI();
gui.title('Black Hole — Debug');
gui.add(params, 'scaleM', 2.0, 50.0, 0.1).name('Scale (M per NDC)');
gui.add(params, 'massM', 0.2, 5.0, 0.1).name('Mass M');
gui.add(params, 'quality', 16, 128, 2).name('Integration steps');
gui.add(params, 'fovY', 20, 120, 1).name('FOV (deg)');
gui.add(params, 'yaw', -180, 180, 1).name('Yaw');
gui.add(params, 'pitch', -89, 89, 1).name('Pitch');
gui.add(params, 'roll', -180, 180, 1).name('Roll');
gui.add(params, 'exposure', 0.2, 3.0, 0.05).name('Exposure');
gui.add(params, 'gamma', 0.6, 2.2, 0.01).name('Gamma');
gui.add(params, 'useTexture').name('Use sky texture');
gui
	.add(params, 'bg', backgrounds)
	.name('Background')
	.onChange((bg: string) => {
		const img = new Image();
		img.src = bg;
		img.onload = () => {
			skyTex = makeTexture(img);
		};
	});
gui.add(derived, 'shadowRadiusNDC').name('Shadow radius (NDC)').listen();

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

// ----- Resize & draw -----
function resizeCanvas() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const w = Math.floor(canvas.clientWidth * dpr);
	const h = Math.floor(canvas.clientHeight * dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	gl.viewport(0, 0, canvas.width, canvas.height);
}

function deg2rad(d: number) {
	return (d * Math.PI) / 180;
}

function frame(tMs: number) {
	resizeCanvas();
	derived.shadowRadiusNDC = (3 * Math.sqrt(3) * params.massM) / params.scaleM;

	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.uniform2f(uResolution, canvas.width, canvas.height);
	gl.uniform1f(uTime, tMs * 0.001);
	gl.uniform1f(uAspect, canvas.width / canvas.height);
	gl.uniform1f(uScaleM, params.scaleM);
	gl.uniform1f(uMassM, params.massM);
	gl.uniform1f(uExposure, params.exposure);
	gl.uniform1f(uGamma, params.gamma);
	gl.uniform1i(uUseTex, params.useTexture ? 1 : 0);
	gl.uniform1i(uQuality, params.quality);
	gl.uniform1f(uFovY, deg2rad(params.fovY));

	// Build yaw/pitch/roll matrix
	const cy = Math.cos(deg2rad(params.yaw)),
		sy = Math.sin(deg2rad(params.yaw));
	const cp = Math.cos(deg2rad(params.pitch)),
		sp = Math.sin(deg2rad(params.pitch));
	const cr = Math.cos(deg2rad(params.roll)),
		sr = Math.sin(deg2rad(params.roll));

	// R = Rz(yaw) * Rx(pitch) * Ry(roll) [you can reorder if needed]
	const rot = new Float32Array([
		cy * cr + sy * sp * sr,
		sr * cp,
		-sy * cr + cy * sp * sr,
		-cy * sr + sy * sp * cr,
		cr * cp,
		sr * sy + cy * sp * cr,
		sy * cp,
		-sp,
		cy * cp,
	]);
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
