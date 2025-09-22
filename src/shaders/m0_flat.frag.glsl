#version 300 es
precision highp float;

in vec2 v_ndc;
out vec4 outColor;

uniform vec2  uResolution;
uniform mat4  uInvProj;
uniform mat4  uInvView;
uniform vec3  uCamPos;
uniform sampler2D uStarTex;
uniform float uTime;
uniform float uExposure;

// NEW: debug wobble controls
uniform int   uWobbleOn;   // 0/1
uniform float uWobbleDeg;  // degrees peak
uniform float uWobbleHz;   // cycles per second

vec3 tonemap(vec3 c, float exposure) {
	c = vec3(1.0) - exp(-c * exposure);
	return pow(c, vec3(1.0/2.2));
}

vec3 rayDirWorld(vec2 ndc) {
	vec4 clip = vec4(ndc, 0.0, 1.0);
	vec4 vpos = uInvProj * clip;
	vpos /= vpos.w;
	vec4 wdir = uInvView * vec4(vpos.xyz, 0.0);
	return normalize(wdir.xyz);
}

vec3 sampleEquirect(vec3 dir) {
	float phi = atan(dir.z, dir.x);
	float theta = acos(clamp(dir.y, -1.0, 1.0));
	vec2 uv = vec2(phi / (2.0*3.141592653589793) + 0.5, theta / 3.141592653589793);
	return texture(uStarTex, uv).rgb;
}

// NEW: yaw rotation around Y
mat3 rotY(float a){
	float c = cos(a), s = sin(a);
	return mat3( c, 0.0,  s,
	0.0, 1.0, 0.0,
	-s, 0.0,  c );
}

void main() {
	vec3 dirW = rayDirWorld(v_ndc);
	
	// NEW: obvious wobble — rotate a few degrees at a user-set frequency
	if (uWobbleOn == 1) {
		float ang = radians(uWobbleDeg) * sin(6.28318530718 * uWobbleHz * uTime);
		dirW = rotY(ang) * dirW;
	}
	
	vec3 sky = sampleEquirect(normalize(dirW));
	outColor = vec4(tonemap(sky, uExposure), 1.0);
}
