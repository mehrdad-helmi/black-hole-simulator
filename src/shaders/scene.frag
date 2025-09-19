#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uAspect;     // width / height
uniform float uScaleM;     // M per NDC unit
uniform float uMassM;      // black hole mass (geom)
uniform float uExposure;
uniform float uGamma;
uniform bool  uUseTex;
uniform sampler2D uTex;
uniform int   uQuality;
uniform float uFovY;       // vertical FOV (radians)
uniform mat3  uCamRot;     // yaw/pitch/roll rotation

// ---------- helpers ----------
vec3 tonemap(vec3 c, float exposure, float gamma) {
	c = vec3(1.0) - exp(-c * exposure);
	c = pow(max(c, 0.0), vec3(1.0 / gamma));
	return c;
}
vec2 equirectUV(vec3 dir) {
	dir = normalize(dir);
	float lon = atan(dir.x, dir.z);
	float lat = asin(clamp(dir.y, -1.0, 1.0));
	return vec2(lon/(2.0*3.141592653589793)+0.5, lat/3.141592653589793+0.5);
}
vec3 gradientBG(vec2 uv) {
	vec3 top = vec3(0.02,0.03,0.07);
	vec3 bottom = vec3(0.0,0.0,0.0);
	return mix(bottom, top, smoothstep(0.0,1.0,uv.y));
}
vec3 rotateAroundAxis(vec3 v, vec3 axis, float a) {
	float c = cos(a), s = sin(a);
	return v*c + cross(axis,v)*s + axis*dot(axis,v)*(1.0-c);
}

// ---------- Schwarzschild deflection ----------
float f_u(float u, float invb2, float M) { return invb2 - u*u + 2.0*M*u*u*u; }
float find_u_min(float invb2, float M) {
	float u_hi = 1.0/(3.0*M);
	float f_hi = f_u(u_hi, invb2, M);
	if (f_hi >= 0.0) return -1.0; // b <= b_c → capture
	float u_lo = 0.0;
	for (int i=0;i<24;++i) {
		float u_mid = 0.5*(u_lo+u_hi);
		float f_mid = f_u(u_mid, invb2, M);
		if (f_mid > 0.0) u_lo = u_mid; else u_hi = u_mid;
	}
	return 0.5*(u_lo+u_hi);
}
float simpson_integral(float u_max, float invb2, float M, int N) {
	if (N < 2) N = 2;
	if ((N & 1) == 1) N += 1;
	float h = u_max/float(N);
	float sum_odd=0.0, sum_even=0.0;
	float g0 = inversesqrt(max(f_u(0.0, invb2, M), 1e-24));
	float gN = inversesqrt(max(f_u(u_max, invb2, M), 1e-24));
	for (int i=1;i<N;++i) {
		float u = float(i)*h;
		float g = inversesqrt(max(f_u(u, invb2, M), 1e-24));
		if ((i & 1) == 1) sum_odd += g; else sum_even += g;
	}
	return (h/3.0)*(g0 + 4.0*sum_odd + 2.0*sum_even + gN);
}
float deflection_alpha(float b, float M, int quality) {
	float b_c = 3.0*sqrt(3.0)*M;
	if (b <= b_c) return 0.0;
	float invb2 = 1.0/(b*b);
	float u_min = find_u_min(invb2, M);
	if (u_min <= 0.0) return 0.0;
	float eps = 1e-5*u_min;
	float I = simpson_integral(u_min - eps, invb2, M, quality);
	return 2.0*I - 3.141592653589793;
}

// ---------- main ----------
void main() {
	// NDC in [-1,1]
	vec2 ndc = vUv * 2.0 - 1.0;
	
	// pinhole projection with vertical FOV
	float tanHalfFovY = tan(uFovY * 0.5);
	float tanHalfFovX = uAspect * tanHalfFovY;
	
	// camera-space ray (before rotation)
	vec3 rayCam = normalize(vec3(ndc.x * tanHalfFovX,
	ndc.y * tanHalfFovY,
	1.0));
	
	// rotate into world
	vec3 ray = normalize(uCamRot * rayCam);
	
	// --- CORRECT impact parameter using angular radius (fix for oval) ---
	// angular radius proxy in camera space (small-angle): rho = sqrt((x*tanFovX/2)^2 + (y*tanFovY/2)^2)
	float rho = length(vec2(ndc.x * tanHalfFovX, ndc.y * tanHalfFovY));
	float b   = rho * uScaleM;   // M
	
	float M = uMassM;
	float b_c = 3.0*sqrt(3.0)*M;
	if (b <= b_c) { outColor = vec4(0.0); return; }
	
	float alpha = deflection_alpha(b, M, uQuality);
	
	// rotate around the plane defined by (ray, camera forward)
	vec3 camForward = normalize(uCamRot * vec3(0.0, 0.0, 1.0));
	vec3 axis = normalize(cross(ray, camForward));
	if (length(axis) < 1e-6) axis = vec3(0.0, 1.0, 0.0);
	
	vec3 dir_src = rotateAroundAxis(ray, axis, -alpha);
	
	vec3 col = uUseTex
	? texture(uTex, equirectUV(dir_src)).rgb
	: gradientBG(equirectUV(dir_src));
	
	col = tonemap(col, uExposure, uGamma);
	outColor = vec4(col, 1.0);
}
