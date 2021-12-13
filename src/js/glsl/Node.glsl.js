export const NodeVertexShader = `
uniform bool isPick;
uniform float scale;

attribute float pickId;
attribute float visible;
attribute vec3 color;
attribute float size;

varying vec3 vColor;
varying float vShow;

const float _f = 65536.0;
vec3 unpackColor(float f){
    vec3 color;
    color.r = floor(f / _f);
    color.g = floor((f - color.b * _f) / 256.0);
    color.b = floor(f - color.b * _f - color.g * 256.0);
    return color / 255.0;
}

void main(){
    gl_PointSize = floor(size * scale);
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position.xy, 0, 1);
    vec3 diffuse = color;
    vColor = isPick ? unpackColor(pickId) : diffuse;
    vShow = visible;
}
`
export const NodeFragShader = `
uniform float showMode;

uniform bool isPick;

varying vec3 vColor;
varying float vShow;

bool decideShow(){
    if(isPick){
        return vShow != -1.0;
    }else{
        //(vShow == 1.0 && showMode == 1.0) || (vShow == 0.0 && showMode == 2.0) 
        return vShow + showMode == 2.0;
    }
}

void main(){
    if(!decideShow()){
        discard;
    }
    float len = length(gl_PointCoord - vec2(0.5));
    if(len > 0.5) discard;
    float a = isPick ? 1.0 : 1.0 - smoothstep(0.45, 0.5, len);
    gl_FragColor = vec4(vColor, a);
}
`
