precision highp float;

in vec2 v_ndc;
out vec4 outColor;

uniform vec2  uResolution;
uniform mat4  uInvProj;
uniform mat4  uInvView;
uniform vec3  uCamPos;      // world-space camera position (in M)
uniform sampler2D uStarTex;
uniform float uTime;
uniform float uExposure;

// Integrator caps / perf
uniform int   uMaxSteps;
uniform float uLambdaMax;
uniform float uMassM;
uniform float uRMax;
uniform float uRHorizonEps;
uniform float uHMin, uHMax, uStrongWidth;
uniform float uCurvEps, uAsymR, uAsymDrdl;

// Thin disk (z=0)
uniform int   uDiskOn;       // 0/1
uniform float uDiskRin;      // [M]
uniform float uDiskRout;     // [M]
uniform float uDiskQ;        // emissivity power, I_em ∝ r^{-q}
uniform vec3  uDiskColInner; // color near Rin
uniform vec3  uDiskColOuter; // color near Rout
uniform int   uDiskChecker;  // 0/1
uniform float uCheckSize;    // [M]
uniform float uDiskI0;       // overall intensity scale

// NEW: Hotspot (Keplerian, equatorial)
uniform int   uHotOn;        // 0/1
uniform float uHotR;         // [M] hotspot radius (≥ Rin)
uniform float uHotAmp;       // multiplicative amplitude
uniform float uHotSigmaR;    // [M] radial stddev
uniform float uHotSigmaPhi;  // [rad] azimuth stddev

// Debug wobble (camera yaw)
uniform int   uWobbleOn;
uniform float uWobbleDeg;
uniform float uWobbleHz;

// add at top with other uniforms:
uniform float uTanHalfFovX;  // tan(FOVx/2)
uniform float uTanHalfFovY;  // tan(FOVy/2)

uniform float uPlaneTight;  // [M] shrink steps when |z| < this
uniform int   uZRefine;     // (2..8) bisection iterations for z=0 hit


const float PI = 3.141592653589793;

// ---------- select() ----------
float select(float a, float b, bool c) { return mix(a, b, c); }
vec2  select(vec2  a, vec2  b, bool c) { return mix(a, b, bvec2(c)); }
vec3  select(vec3  a, vec3  b, bool c) { return mix(a, b, bvec3(c)); }
vec4  select(vec4  a, vec4  b, bool c) { return mix(a, b, bvec4(c)); }

// ---------- helpers ----------
vec3 tonemap(vec3 c, float exposure){ c = vec3(1.0) - exp(-c*exposure); return pow(c, vec3(1.0/2.2)); }
vec3 sampleEquirect(vec3 d){ float phi=atan(d.z,d.x); float th=acos(clamp(d.y,-1.0,1.0));
	return texture(uStarTex, vec2(phi/(2.0*PI)+0.5, th/PI)).rgb; }
vec3 rayDirWorld(vec2 ndc){
	// camera basis in world from the matrix columns of uInvView (camera.matrixWorld)
	vec3 camRight   = normalize(vec3(uInvView[0][0], uInvView[1][0], uInvView[2][0]));
	vec3 camUp      = normalize(vec3(uInvView[0][1], uInvView[1][1], uInvView[2][1]));
	vec3 camForward = normalize(-vec3(uInvView[0][2], uInvView[1][2], uInvView[2][2])); // -Z is forward
	
	// view-space direction through the pixel, then rotate into world
	vec3 dirW = camForward
	+ ndc.x * uTanHalfFovX * camRight
	+ ndc.y * uTanHalfFovY * camUp;
	
	return normalize(dirW);
}

mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
float pick3(vec3 v,int i){ float r=v.x; r=select(r,v.y,i==1); r=select(r,v.z,i==2); return r; }
float pick4(vec4 v,int i){ float r=v.x; r=select(r,v.y,i==1); r=select(r,v.z,i==2); r=select(r,v.w,i==3); return r; }
float checker(vec2 p){ vec2 g=floor(p/max(uCheckSize,1e-6)); return mod(g.x+g.y,2.0); }
float wrapPi(float a){ return mod(a+PI, 2.0*PI) - PI; }

// ---------- state ----------
struct State { vec4 x; vec4 k; }; // x=(t,x,y,z), k=(kt,kx,ky,kz)

// ---------- Schwarzschild (Kerr–Schild form, a=0) ----------
float dH_dxi(int i, vec3 X, float r, float M){ if(r<=0.0) return 0.0; float xi=pick3(X,i); return -M*xi/(r*r*r); }
float dli_dxi(int i,int j,vec3 X,float r){ if(j==0||r<=0.0) return 0.0; int jj=j-1; float xi=pick3(X,i), xj=pick3(X,jj);
	float delta=select(0.0,1.0,i==jj); return delta/r - (xj*xi)/(r*r*r); }
float l_comp(int mu, vec3 n){ float val=pick3(n,0); val=select(val,n.y,mu==2); val=select(val,n.z,mu==3); val=select(val,1.0,mu==0); return select(val,n.x,mu==1); }
float dg_alpha_munu(int a,int mu,int nu,vec3 X,float r,float M,float H,vec3 n){
	if(a==0) return 0.0;
	float dH=dH_dxi(a-1,X,r,M);
	float lmu=l_comp(mu,n), lnu=l_comp(nu,n);
	float dl_mu=dli_dxi(a-1,mu,X,r), dl_nu=dli_dxi(a-1,nu,X,r);
	return 2.0*( dH*lmu*lnu + H*dl_mu*lnu + H*lmu*dl_nu );
}
vec4 gInv_times_lower(vec4 S,float H,vec3 n){ vec4 l_up=vec4(-1.0,n); vec4 etaUp_S=vec4(-S.x,S.y,S.z,S.w);
	float ldotS=dot(l_up,S); return etaUp_S - 2.0*H*l_up*ldotS; }
float sumForSigma(int sigma, vec4 k, vec3 X,float r,float M,float H,vec3 n){
	float ssum=0.0; for(int a=0;a<4;++a){ float ka=pick4(k,a);
		for(int b=0;b<4;++b){ float kb=pick4(k,b);
			float term= dg_alpha_munu(a,sigma,b,X,r,M,H,n)
			+ dg_alpha_munu(b,sigma,a,X,r,M,H,n)
			- dg_alpha_munu(sigma,a,b,X,r,M,H,n);
			ssum+=term*ka*kb; } } return ssum; }
State derivSchwarz(State s,float M){
	vec3 X=s.x.yzw; float r=length(X);
	float H=select(0.0,M/r,r>0.0); vec3 n=select(vec3(0.0), X/max(r,1e-9), r>0.0);
	float S0=sumForSigma(0,s.k,X,r,M,H,n), S1=sumForSigma(1,s.k,X,r,M,H,n);
	float S2=sumForSigma(2,s.k,X,r,M,H,n), S3=sumForSigma(3,s.k,X,r,M,H,n);
	vec4 gInvS=gInv_times_lower(vec4(S0,S1,S2,S3),H,n);
	State d; d.x=s.k; d.k=-0.5*gInvS; return d;
}
State addS(State a, State b, float h){ State r; r.x=a.x+h*b.x; r.k=a.k+h*b.k; return r; }
State rk4_step_schw(State y,float h,float M){
	State k1=derivSchwarz(y,M);
	State k2=derivSchwarz(addS(y,k1,0.5*h),M);
	State k3=derivSchwarz(addS(y,k2,0.5*h),M);
	State k4=derivSchwarz(addS(y,k3,h),M);
	State inc; inc.x=(k1.x+2.0*k2.x+2.0*k3.x+k4.x)*(h/6.0);
	inc.k=(k1.k+2.0*k2.k+2.0*k3.k+k4.k)*(h/6.0);
	return addS(y,inc,1.0);
}

// ---------- metric lower × upper (g_{μν} v^ν) at X ----------
vec4 gLower_times_upper(vec4 v, vec3 X, float M){
	float r=length(X); float H=select(0.0,M/r,r>0.0);
	vec3 n=select(vec3(0.0), X/max(r,1e-9), r>0.0);
	// η_{μν} v^ν = (-v^0, v^1, v^2, v^3)
	vec4 eta = vec4(-v.x, v.y, v.z, v.w);
	// + 2H l_μ (l_ν v^ν), with l_μ=(1,n)
	vec4 l_low = vec4(1.0, n);
	float ldotv = dot(l_low, v);
	return eta + 2.0*H * l_low * ldotv;
}

// ---------- observers / emitters ----------
vec4 u_obs_static(vec3 X, float M){
	float r=length(X); float alpha2 = select(1.0-2.0*M/max(r,1e-9), 1.0-2.0*M/r, r>0.0);
	float ut = 1.0 / sqrt(max(alpha2, 1e-9)); // u^i = 0
	return vec4(ut, 0.0, 0.0, 0.0);
}
// Keplerian on z=0: Ω = sqrt(M/ρ^3), u^t = 1/sqrt(1-3M/ρ), u^i = u^t Ω (-y, x, 0)
vec4 u_em_kepler(vec3 X, float M){
	vec2 xy = X.xy; float rho = length(xy);
	float om = sqrt(max(M,1e-9)/pow(max(rho,1e-9),3.0));
	float ut = 1.0 / sqrt(max(1.0 - 3.0*M/max(rho,1e-9), 1e-6));
	vec3 vt = ut * om * vec3(-X.y, X.x, 0.0);
	return vec4(ut, vt);
}

// ---------- disk shading ----------
vec3 shadeDiskBase(float rho){
	float t = clamp((rho - uDiskRin) / max(uDiskRout - uDiskRin, 1e-6), 0.0, 1.0);
	vec3 base = mix(uDiskColInner, uDiskColOuter, t);
	float I = uDiskI0 * pow(max(rho, 1e-6), -uDiskQ);
	return base * I;
}
float hotspotWeight(float rho, float phi, float t){
	if(uHotOn==0) return 0.0;
	float om = sqrt(max(uMassM,1e-9)/pow(max(uHotR,1e-9),3.0)); // Keplerian Ω at r0
	float phi0 = om * t; // simple phase
	float dphi = wrapPi(phi - phi0);
	float w_r   = exp(-0.5 * pow((rho - uHotR)/max(uHotSigmaR,1e-6), 2.0));
	float w_phi = exp(-0.5 * pow(dphi / max(uHotSigmaPhi,1e-6), 2.0));
	return uHotAmp * (w_r * w_phi);
}

void main(){
	// camera ray
	vec3 dirW = rayDirWorld(v_ndc);
	if (uWobbleOn==1){
		float ang = radians(uWobbleDeg) * sin(6.28318530718 * uWobbleHz * uTime);
		dirW = rotY(ang) * dirW;
	}
	
	// initial state at camera
	State s; s.x = vec4(0.0, uCamPos); s.k = vec4(1.0, dirW);
	State sp = s;
	
	// k·u at observer (for g-factor numerator)
	vec4 uObs = u_obs_static(uCamPos, uMassM);
	vec4 kCam_lower = gLower_times_upper(s.k, uCamPos, uMassM);
	float nuObs = -dot(kCam_lower, uObs); // >0
	
	float lambda=0.0;
	float rH = 2.0*uMassM + uRHorizonEps;
	
	bool hitH=false, escaped=false, hitDisk=false;
	vec3 diskColor = vec3(0.0);
	
	for (int i=0;i<4096;++i){
		if(i>=uMaxSteps) break;
		
		vec3 X = s.x.yzw;
		float r = length(X);
		float curv = select(1e9, uMassM/(r*r*r), r>0.0);
		float drdl = select(0.0, dot(X, s.k.yzw)/max(r,1e-9), r>0.0);
		
		if (r <= rH) { hitH=true; break; }
		if (r >= uRMax) { escaped=true; break; }
		if (lambda >= uLambdaMax) break;
		
		float band = clamp((r - rH)/uStrongWidth, 0.0, 1.0);
		float h = mix(uHMin, uHMax, band);
		
		// NEW: smaller steps as we approach z=0 plane to avoid skipping it
		float zabs = abs(s.x.w);
		float hScale = clamp(zabs / max(uPlaneTight, 1e-6), 0.2, 1.0);
		h *= hScale;
		
		
		// step (keep previous)
		sp = s;
		s = rk4_step_schw(s, h, uMassM);
		lambda += h;
		
		// thin disk plane z=0 crossing?
		// --- thin disk plane z=0 crossing?
		if (uDiskOn == 1){
			float z0 = sp.x.w, z1 = s.x.w;
			bool cross = (z0==0.0 && z1==0.0) ? false : ((z0<=0.0 && z1>=0.0) || (z0>=0.0 && z1<=0.0));
			if (cross){
				// bracket [0,h] around the zero; refine with fixed-iter bisection
				float a = 0.0;
				float b = h;
				State sa = sp;
				State sb = s;
				
				// refine z=0: after this, sb is very close to the plane
				for (int it=0; it<8; ++it){
					if (it >= uZRefine) break;
					float m = 0.5 * (a + b);
					State sm = rk4_step_schw(sp, m, uMassM);
					// choose the sub-interval that still brackets zero
					bool leftHasZero = (sa.x.w == 0.0) ? true : (sa.x.w * sm.x.w <= 0.0);
					if (leftHasZero) { b = m; sb = sm; }
					else { a = m; sa = sm; }
				}
				
				// state exactly (well… very close) at the plane
				State sc = sb;
				vec3  Xc = sc.x.yzw;
				float rho = length(Xc.xy);
				
				// only first inbound hit
				float inward0 = dot(sp.x.yzw, sp.k.yzw);
				bool goingIn = (inward0 < 0.0);
				
				if (goingIn && rho>=uDiskRin && rho<=uDiskRout && length(Xc) > rH){
					// g-factor at the refined crossing
					vec4 kEm_lower = gLower_times_upper(sc.k, Xc, uMassM);
					vec4 uEm = u_em_kepler(Xc, uMassM);
					float nuEm = -dot(kEm_lower, uEm);
					float g = nuObs / max(nuEm, 1e-9);
					
					float phi = atan(Xc.y, Xc.x);
					float hot = hotspotWeight(rho, phi, uTime);
					
					vec3 baseCol;
					if (uDiskChecker==1){
						float c = checker(Xc.xy);
						baseCol = mix(vec3(0.08), vec3(1.0), c) * (0.5 + 0.5*pow(max(rho,1e-6), -0.3));
					} else {
						baseCol = shadeDiskBase(rho);
					}
					
					diskColor = baseCol * (1.0 + hot) * (g*g*g);
					hitDisk = true;
					break;
				}
			}
		}
		
		
		// asymptotic bailout
		if ( (r>uAsymR) && (drdl>uAsymDrdl) && (curv<uCurvEps) ){ escaped=true; break; }
	}
	
	if (hitH){ outColor=vec4(0.0,0.0,0.0,1.0); return; }
	if (hitDisk){ outColor=vec4(tonemap(diskColor, uExposure), 1.0); return; }
	
	vec3 sky = sampleEquirect(normalize(s.k.yzw));
	outColor = vec4(tonemap(sky, uExposure), 1.0);
}
