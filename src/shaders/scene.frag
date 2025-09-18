#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;

// Simple background "space-ish" gradient
vec3 background(vec2 uv) {
	vec3 top = vec3(0.02, 0.03, 0.07);
	vec3 bottom = vec3(0.0, 0.0, 0.0);
	return mix(bottom, top, smoothstep(0.0, 1.0, uv.y)) * (0.9 + 0.1*cos(6.2831*uv.x));
	
}

void main() {
	vec3 col = background(vUv);
	
	// Placeholder: a central black disk (we’ll replace with GR later)
	float r = 0.22;
	float d = distance(vUv, vec2(0.5));
	if (d < r) col = vec3(0.0);
	
	outColor = vec4(col, 1.0);
}
