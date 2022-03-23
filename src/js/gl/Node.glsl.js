export const NodeVertexShader = `
uniform bool isPick;
uniform float scale;

attribute float pickId;
attribute vec3 show_hl_size;
attribute vec3 color;

varying vec3 vColor;
varying float vShow;
varying float vIsHl;
varying float vSize;

const float _f = 65536.0;
vec3 unpackColor(float f){
    vec3 color;
    color.r = floor(f / _f);
    color.g = floor((f - color.b * _f) / 256.0);
    color.b = floor(f - color.b * _f - color.g * 256.0);
    return color / 255.0;
}

void main(){
    float visible = show_hl_size[0];
    float isHl = show_hl_size[1];
    float size = show_hl_size[2];
    
    vSize = gl_PointSize = floor(size * scale);
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position.xy, 0, 1);
    vec3 diffuse = color;
    vColor = isPick ? unpackColor(pickId) : diffuse;
    vShow = visible;
    vIsHl = isHl;
}
`
export const NodeFragShader = `
uniform float showMode;

uniform bool isPick;

varying vec3 vColor;
varying float vShow;
varying float vSize;
varying float vIsHl;

bool decideShow(){
    return  showMode == 0.0 
         || (showMode == 1.0 && vShow == 1.0) 
         || (showMode == 2.0 && vShow == 0.0);  
}

void main(){
    if(!isPick && !decideShow()){
        discard;
    }
    float len = length(gl_PointCoord - vec2(0.5));
    if(len > 0.5) discard;
    
    vec3 color = vColor;
    float a = 1.0;
    if(!isPick){
        if(vIsHl > 0.0){
            float s = 2.5 / vSize; //border
            float step1 = 0.5 - s * 2.0;
            float weight = len < step1 ? 0.0 : clamp((len - step1) / s, 0.0, 1.0);
            color = mix(vColor, vColor * 1.5, weight);
        }else{
            color = vColor;
        }
        a = 1.0 - smoothstep(0.45, 0.5, len);
    }
    gl_FragColor = vec4(color, a);
}
`
