import vertSrc from './shaders/fullscreen.vert';
import fragSrc from './shaders/scene.frag';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) {
	alert('WebGL2 not supported');
	throw new Error('WebGL2 not supported');
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const sh = gl.createShader(type)!;
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		gl.deleteShader(sh);
		throw new Error('Shader compile error: ' + log);
	}
	return sh;
}

async function makeProgram() {
	const vs = compile(gl!, gl!.VERTEX_SHADER, vertSrc);
	const fs = compile(gl!, gl!.FRAGMENT_SHADER, fragSrc);

	const prog = gl!.createProgram()!;
	gl!.attachShader(prog, vs);
	gl!.attachShader(prog, fs);
	gl!.linkProgram(prog);

	if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
		const log = gl!.getProgramInfoLog(prog);
		gl!.deleteProgram(prog);
		throw new Error('Program link error: ' + log);
	}

	gl!.deleteShader(vs);
	gl!.deleteShader(fs);
	return prog;
}

function resizeCanvas() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const w = Math.floor(canvas.clientWidth * dpr);
	const h = Math.floor(canvas.clientHeight * dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	gl!.viewport(0, 0, canvas.width, canvas.height);
}

(async function init() {
	const program = await makeProgram();
	gl!.useProgram(program);

	const uResolution = gl!.getUniformLocation(program, 'uResolution');
	const uTime = gl!.getUniformLocation(program, 'uTime');

	function frame(tMs: number) {
		resizeCanvas();

		gl!.clearColor(0, 0, 0, 1);
		gl!.clear(gl!.COLOR_BUFFER_BIT);

		gl!.uniform2f(uResolution, canvas.width, canvas.height);
		gl!.uniform1f(uTime, tMs * 0.001);

		// Draw the full-screen "big triangle"
		gl!.drawArrays(gl!.TRIANGLES, 0, 3);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);
})().catch((err) => console.error(err));
