export const linkVertexShader = `
uniform float lineWidthScale;
uniform vec2 resolution;
uniform bool isPick;

attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute vec3 instanceLineColorStart;
attribute vec3 instanceLineColorEnd;
attribute float instanceLineDisOffset;
attribute float instanceLineWidth;
attribute float instanceVisible;
attribute float instanceFlowEnable;
attribute float instancePickId;
attribute float instanceDisStart;
attribute float instanceDisEnd;

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

void main() {

    vLineDistance = ( position.y < 0.5 ) ? instanceDisStart : instanceDisEnd;
    vLineDistance += instanceLineDisOffset;
    vShow = instanceVisible;
    vFlowEnable = instanceFlowEnable;
    
    vColor = isPick ? unpackColor(instancePickId)
                    : mix(instanceLineColorStart, instanceLineColorEnd, vLineDistance);
    
    vUv = uv;

    float aspect = resolution.x / resolution.y;

    // clip space
    vec4 clipStart = projectionMatrix * modelViewMatrix * vec4( instanceStart, 1.0 );
    vec4 clipEnd = projectionMatrix * modelViewMatrix * vec4( instanceEnd, 1.0 );

    // ndc space
    vec3 ndcStart = clipStart.xyz / clipStart.w;
    vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

    // direction
    vec2 dir = ndcEnd.xy - ndcStart.xy;

    // account for clip-space aspect ratio
    dir.x *= aspect;
    dir = normalize( dir );

    vec2 offset = vec2( dir.y, - dir.x );
    // undo aspect ratio adjustment
    dir.x /= aspect;
    offset.x /= aspect;
    
  
    // sign flip
    if ( position.x < 0.0 ) offset *= - 1.0;

    // endcaps
    if ( position.y < 0.0 ) {
        offset += - dir;
    } else if ( position.y > 1.0 ) {
        offset += dir;
    }

    // adjust for linewidth
    offset *= instanceLineWidth * lineWidthScale;

    // adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
    offset /= resolution.y;

    // select end
    vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

    // back to clip space
    offset *= clip.w;
    
    clip.xy += offset;
    
    gl_Position = clip;
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

uniform vec2 resolution;
uniform float time;
uniform float minAlpha;
uniform trail uTrail;

#ifdef USE_DASH
    uniform float dashSize;
    uniform float gapSize;
    uniform float dashOffset;
#endif

varying vec2 vUv;
varying vec3 vColor;
varying float vLineDistance;
varying float vShow;
varying float vFlowEnable;

bool decideShow(){
    if(isPick){
        return vShow != -1.0;
    }else{
        //(vShow == 1.0 && showMode == 1.0) || (vShow == 0.0 && showMode == 2.0) 
        return vShow + showMode == 2.0;
    }
}

void main() {
     if(!decideShow()){
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
        alpha *= 1.0 - smoothstep(0.3, 1.0, abs(vUv.x));
     }
     gl_FragColor = vec4( vColor, alpha );
}
`
