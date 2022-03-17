export const linkVertexShader = `
uniform float lineWidthScale;
uniform vec2 resolution;
uniform bool isPick;

//the max attributes nums is 16, so pack it 

attribute vec4 instance_Bzr_T; // [beforeT, sourceT, targetT, afterT]
attribute vec4 instance_C1_Dis;      // [c1x, c1y, startDis, endDis]
attribute vec4 instance_C2_C3;       // [c2x, c2y, c3x, c3y]

attribute vec3 instanceLineColorStart;
attribute vec3 instanceLineColorEnd;

attribute vec2 instance_PickId_Offset;//[pickid, disOffset]

attribute float instanceLineWidth;
attribute float instanceVisible;
attribute float instanceFlowEnable;


varying vec2 vUv;
varying vec3 vColor;
varying float vLineDistance;
varying float vShow;
varying float vFlowEnable;

const float _f = 65536.0;
vec3 unpackColor(float f){
    vec3 color;
    color.r = floor(f / _f);
    color.g = floor((f - color.b * _f) / 256.0);
    color.b = floor(f - color.b * _f - color.g * 256.0);
    return color / 255.0;
}

vec2 getBzrPoint(float t){
    float F = 1.0 - t;
    vec2 p1 = instance_C1_Dis.xy;
    vec2 p2 = instance_C2_C3.xy;
    vec2 p3 = instance_C2_C3.zw;
    return (F * F * p1) + (2.0 * t * F * p2) + (t * t * p3);
}

vec2 worldToScreen(vec2 point){
    vec4 clip = projectionMatrix * modelViewMatrix * vec4( point, 0.0, 1.0 );
    vec3 ndc = clip.xyz / clip.w;
    return vec2(
        (ndc.x + 1.0) * resolution.x * 0.5,
       -(ndc.y - 1.0) * resolution.y * 0.5
    );
}
vec2 screenToNDC(vec2 point){
    return vec2(
        2.0 * point.x / resolution.x - 1.0,
       -2.0 * point.y / resolution.y + 1.0
    );
}

void main() {
    vLineDistance = ( position.y < 0.5 ) ? instance_C1_Dis[2] : instance_C1_Dis[3];
    vLineDistance += instance_PickId_Offset[1];
    vShow = instanceVisible;
    vFlowEnable = instanceFlowEnable;
    vColor = isPick ? unpackColor(instance_PickId_Offset[0])
                : mix(instanceLineColorStart, instanceLineColorEnd, vLineDistance);
    vUv = uv;
    
    vec2 pSource = getBzrPoint(instance_Bzr_T[1]);
    vec2 pTarget = getBzrPoint(instance_Bzr_T[2]);  
    vec2 spSource = worldToScreen(pSource);
    vec2 spTarget = worldToScreen(pTarget);
    
    vec2 screenPos = ( position.y < 0.5 ) ? spSource : spTarget;
    
    vec2 dirST = spTarget - spSource; //屏幕dir
    dirST = normalize(dirST);
    
    //take bevel in account
    
    vec2 d01, d12;
    if(position.y < 0.5){
        bool same01 = instance_Bzr_T[0] == instance_Bzr_T[1];
        d01 = same01 ? dirST : spSource - worldToScreen(getBzrPoint(instance_Bzr_T[0]));
        if(!same01) d01 = normalize(d01);
        d12 = dirST;
    }else{
        bool same23 = instance_Bzr_T[2] == instance_Bzr_T[3];
        d01 = dirST;
        d12 = same23 ? dirST : worldToScreen(getBzrPoint(instance_Bzr_T[3])) - spTarget;
        if(!same23) d12 = normalize(d12);
    }
    
    vec2 vHalf = d01 + d12;
    vHalf = normalize(vHalf);
      
    
    float scale = min(1.0 / abs(dot(vHalf, d12)), 10.0);
    vec2 offset = vec2(vHalf.y, -vHalf.x) * scale;
    
    if ( position.x > 0.0 ) offset *= -1.0;
    
    offset *= instanceLineWidth * lineWidthScale * 0.5;
    screenPos += offset;
    
    gl_Position = vec4(screenToNDC(screenPos), 0.0, 1.0);
}
`

export const linkFragShader = `
struct trail {
    float speed;
    float length;
    float cycle;
};
uniform bool isPick;
uniform float showMode;

uniform float time;
uniform float minAlpha;
uniform trail uTrail;

varying vec2 vUv;
varying vec3 vColor;
varying float vLineDistance;
varying float vShow;
varying float vFlowEnable;


bool decideShow(){
    return  showMode == 0.0 
         || (showMode == 1.0 && vShow == 1.0) 
         || (showMode == 2.0 && vShow == 0.0);  
}

void main() {
    if(!isPick && !decideShow()){
        discard;
    }
    if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard;
    float alpha = 1.0;
    if(!isPick){
        if(vFlowEnable > 0.0){
            float dis = mod(mod( vLineDistance - time * uTrail.speed, uTrail.cycle) + uTrail.cycle, uTrail.cycle);
            bool isTrail = (dis >= 0.0 && dis < uTrail.length);
            alpha = isTrail ? clamp(alpha * dis / uTrail.length, minAlpha, 1.0) : minAlpha;
        }
        alpha *= 1.0 - smoothstep(0.5, 1.0, abs(vUv.x));
    }
    gl_FragColor = vec4( vColor, alpha );
}
`
