#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uResolution;
uniform float uAspect;
uniform float uMassM;
uniform float uObserverR;
uniform float uExposure, uGamma;
uniform bool  uUseTex;
uniform sampler2D uTex;
uniform int   uQuality;         // base quality (>=128 looks great)
uniform float uFovY;
uniform mat3  uCamRot;

// Disk controls
uniform bool  uDiskEnable;
uniform float uDiskRin, uDiskRout, uDiskPow;
uniform vec3  uDiskTint;
uniform float uDiskOpacity, uDiskIncDeg, uDiskPaDeg, uDiskThick;

// NEW controls
uniform float uDiskBrightness;   // overall scale
uniform float uBeamingGain;      // SR beaming gain
uniform float uOrderFalloff;     // how fast higher orders fade
uniform int   uDiskBlendMode;    // 0 replace, 1 additive

const float PI = 3.141592653589793;
float deg2rad(float d){ return d * 0.017453292519943295; }

vec3 tonemap(vec3 c, float exposure, float gamma) {
	c = vec3(1.0) - exp(-c * exposure);
	c = pow(max(c, 0.0), vec3(1.0 / gamma));
	return c;
}
vec2 equirectUV(vec3 dir) {
	dir = normalize(dir);
	float lon = atan(dir.x, dir.z);
	float lat = asin(clamp(dir.y, -1.0, 1.0));
	return vec2(lon/(2.0*PI)+0.5, lat/PI+0.5);
}
vec3 gradientBG(vec2 uv) {
	vec3 top = vec3(0.02,0.03,0.07);
	vec3 bot = vec3(0.0);
	return mix(bot, top, smoothstep(0.0,1.0,uv.y));
}
vec3 rotateAroundAxis(vec3 v, vec3 axis, float a) {
	float c = cos(a), s = sin(a);
	return v*c + cross(axis,v)*s + axis*dot(axis,v)*(1.0-c);
}

// ---- Schwarzschild geodesics ----
float f_u(float u, float invb2, float M) { return invb2 - u*u + 2.0*M*u*u*u; }
float find_u_min(float invb2, float M) {
	float u_hi = 1.0/(3.0*M);
	float f_hi = f_u(u_hi, invb2, M);
	if (f_hi >= 0.0) return -1.0;
	float u_lo = 0.0;
	for (int i=0;i<30;++i) {
		float mid = 0.5*(u_lo+u_hi);
		float fm  = f_u(mid, invb2, M);
		if (fm > 0.0) u_lo = mid; else u_hi = mid;
	}
	return 0.5*(u_lo+u_hi);
}
float simpson_integral(float u_max, float invb2, float M, int N) {
	if (N < 2) N = 2;
	if ((N & 1) == 1) N += 1;
	float h = u_max / float(N);
	float so=0.0, se=0.0;
	float g0 = inversesqrt(max(f_u(0.0, invb2, M), 1e-24));
	float gN = inversesqrt(max(f_u(u_max, invb2, M), 1e-24));
	for (int i=1;i<N;++i) {
		float u = float(i)*h;
		float g = inversesqrt(max(f_u(u, invb2, M), 1e-24));
		if ((i & 1)==1) so += g; else se += g;
	}
	return (h/3.0)*(g0 + 4.0*so + 2.0*se + gN);
}
float deflection_alpha(float b, float M, int quality) {
	float bc = 3.0*sqrt(3.0)*M;
	if (b <= bc) return 0.0;
	float invb2 = 1.0/(b*b);
	float u_min = find_u_min(invb2, M);
	if (u_min <= 0.0) return 0.0;
	float I = simpson_integral(u_min*(1.0-1e-5), invb2, M, quality);
	return 2.0*I - PI;
}

// ---- camera & geodesic plane ----
struct Rays { vec3 ray; vec3 fwd; };
Rays makeRays(vec2 uv01, float aspect, float fovY, mat3 camRot) {
	vec2 ndc = uv01*2.0 - 1.0;
	float tY = tan(fovY*0.5);
	float tX = aspect * tY;
	vec3 cam = normalize(vec3(ndc.x*tX, ndc.y*tY, 1.0));
	Rays R;
	R.ray = normalize(camRot * cam);
	R.fwd = normalize(camRot * vec3(0.0,0.0,1.0));
	return R;
}
void geodesicBasis(vec3 ray, vec3 fwd, out vec3 gX, out vec3 gZ, out vec3 gN) {
	gN = normalize(cross(ray, fwd));
	if (length(gN) < 1e-6) gN = vec3(0.0,1.0,0.0);
	gZ = normalize(fwd);
	gX = normalize(cross(gN, gZ));
}

// ---- disk plane ----
vec3 diskNormal(float incDeg, float paDeg) {
	float inc = deg2rad(incDeg), pa = deg2rad(paDeg);
	mat3 Rx = mat3(1,0,0,  0,cos(inc),-sin(inc),  0,sin(inc),cos(inc));
	mat3 Ry = mat3(cos(pa),0,sin(pa),  0,1,0,  -sin(pa),0,cos(pa));
	return normalize(Ry * Rx * vec3(0.0, 1.0, 0.0));
}
void diskBasis(vec3 n, out vec3 du, out vec3 dv) {
	vec3 a = (abs(n.y) < 0.9) ? vec3(0,1,0) : vec3(1,0,0);
	du = normalize(cross(a, n));
	dv = normalize(cross(n, du));
}

// ---- emission model ----
float orbitSpeed(float r, float M) {
	r = max(r, 6.0*M);
	float v = sqrt(M / r);
	return clamp(v, 0.0, 0.85);
}
float dopplerBoost(float v, float cosPsi, float gain) {
	float g = inversesqrt(max(1.0 - v*v, 1e-6));
	float D = 1.0 / (g * max(1.0 - v*cosPsi, 1e-3));
	return pow(D, 3.0*gain);
}
float gravWeight(float r, float M) {
	float f = max(1.0 - 2.0*M/r, 1e-4);
	return sqrt(f);
}
vec3 colorRampHot(float t) {
	t = clamp(t, 0.0, 1.0);
	vec3 c1 = vec3(0.9, 0.3, 0.05);
	vec3 c2 = vec3(1.0, 0.6, 0.1);
	vec3 c3 = vec3(1.0, 0.9, 0.6);
	vec3 c4 = vec3(1.0);
	if (t < 0.33) return mix(c1, c2, t/0.33);
	if (t < 0.66) return mix(c2, c3, (t-0.33)/0.33);
	return mix(c3, c4, (t-0.66)/0.34);
}

// ---- multi-hit disk marcher with sign-change test ----
// ---- multi-hit disk marcher with sign-change test ----
struct Hit { float r; float cosPsi; float orderIdx; bool ok; };

Hit marchDiskMulti(
float rObs, float b, float M, int baseSteps,
vec3 gX, vec3 gZ,            // geodesic-plane basis
vec3 n, vec3 du, vec3 dv,    // disk basis
float diskRin, float diskRout, float diskThick
){
	Hit H; H.ok=false;
	float invb2 = 1.0/(b*b);
	float uTurn = find_u_min(invb2, M);
	if (uTurn <= 0.0) return H;
	
	float alpha = deflection_alpha(b, M, baseSteps);
	float phiMax = min(PI + alpha, 8.0*PI);
	
	int steps = max(baseSteps * 2, 128);
	float dphi = phiMax / float(steps);
	
	float phi = 0.0;
	float u = 1.0 / rObs;
	float sign = +1.0;
	float uTurnEps = uTurn * (1.0 - 1e-4);
	
	vec3 p0 = (1.0/u) * (sin(phi)*gX + cos(phi)*gZ);
	float h_prev = dot(p0, n);
	
	for (int i=0; i<100000; ++i) {
		if (i >= steps) break;
		
		float fu = f_u(u, invb2, M);
		if (fu <= 0.0) return H;
		
		float duphi = sqrt(fu);
		u   += sign * dphi * duphi;
		phi += dphi;
		
		if (sign > 0.0 && u >= uTurnEps) sign = -1.0;
		
		float r = 1.0 / max(u, 1e-6);
		vec3 p = r * (sin(phi)*gX + cos(phi)*gZ);
		
		float h   = dot(p, n);
		float xu  = dot(p, du);
		float yv  = dot(p, dv);
		float ruv = length(vec2(xu, yv));
		
		bool crossed = (h_prev * h <= 0.0) && (abs(h) < diskThick || abs(h_prev) < diskThick);
		
		if (crossed && ruv >= diskRin && ruv <= diskRout) {
			float ord = floor(phi / PI + 1e-3);
			vec3 posHat = normalize(xu*du + yv*dv);
			vec3 tanHat = normalize(cross(n, posHat));
			vec3 dirPlane = normalize(gX*cos(phi) - gZ*sin(phi));
			float cosPsi = clamp(dot(dirPlane, tanHat), -1.0, 1.0);
			
			H.r = ruv; H.cosPsi = cosPsi; H.orderIdx = ord; H.ok = true;
			return H;
		}
		h_prev = h;
	}
	return H;
}


void main() {
	// rays & impact parameter
	Rays R = makeRays(vUv, uAspect, uFovY, uCamRot);
	vec3 gX, gZ, gN; geodesicBasis(R.ray, R.fwd, gX, gZ, gN);
	
	float cosTheta = clamp(dot(R.ray, R.fwd), -1.0, 1.0);
	float theta = acos(cosTheta);
	float b = uObserverR * tan(theta);
	
	float M = uMassM;
	float bc = 3.0*sqrt(3.0)*M;
	
	if (b <= bc) { outColor = vec4(0.0); return; }
	
	// background with correct deflection
	float alpha = deflection_alpha(b, M, uQuality);
	vec3 axis = normalize(cross(R.ray, R.fwd));
	if (length(axis) < 1e-6) axis = vec3(0.0,1.0,0.0);
	vec3 dir_src = rotateAroundAxis(R.ray, axis, -alpha);
	vec3 bgCol = uUseTex ? texture(uTex, equirectUV(dir_src)).rgb
	: gradientBG(equirectUV(dir_src));
	
	// GR disk (multi-hit)
	vec3 outDisk = vec3(0.0);
	float diskMask = 0.0;
	
	if (uDiskEnable) {
		vec3 n = diskNormal(uDiskIncDeg, uDiskPaDeg);
		vec3 du, dv; diskBasis(n, du, dv);
		
		float rin  = uDiskRin;
		float rout = uDiskRout;
		float thick = uDiskThick;
		
		// accumulate up to 3 images
		for (int pass=0; pass<3; ++pass) {
			Hit H = marchDiskMulti(uObserverR, b, M, uQuality, gX, gZ, n, du, dv, rin, rout, thick);
			if (!H.ok) break;
			
			float emiss = pow(max(H.r, 1.0), -uDiskPow);
			float tNorm = clamp((H.r - rin) / max(rout - rin, 1e-3), 0.0, 1.0);
			vec3  bb    = colorRampHot(1.0 - tNorm);
			
			float v   = orbitSpeed(H.r, M);
			float ggr = gravWeight(H.r, M);
			float D   = dopplerBoost(v, H.cosPsi, uBeamingGain);
			float orderFade = 1.0 / (1.0 + uOrderFalloff * H.orderIdx);
			
			outDisk += (bb * uDiskTint) * (emiss * ggr) * D * orderFade;
			diskMask = 1.0;
			
			// nudge the search window slightly to encourage a different hit next pass
			rout *= 0.985;  // local var, not the uniform ✔
		}
		
		outDisk *= uDiskBrightness;
	}
	
	
	// Composite
	vec3 col;
	if (uDiskBlendMode == 1) {
		// ADDITIVE (emissive gas)
		col = bgCol + diskMask * uDiskOpacity * outDisk;
	} else {
		// REPLACE (opaque thin surface)
		col = mix(bgCol, outDisk, diskMask * uDiskOpacity);
	}
	
	col = tonemap(col, uExposure, uGamma);
	outColor = vec4(col, 1.0);
}
