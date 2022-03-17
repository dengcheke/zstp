export const GrayVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

export const GrayFragShader = `
float linearToRelativeLuminance( const in vec3 color ) {
    vec3 weights = vec3( 0.2126, 0.7152, 0.0722 );
    return dot( weights, color.rgb );
}
uniform float opacity;
uniform sampler2D tDiffuse;
uniform float grayScale;
varying vec2 vUv;

void main() {
    vec4 texel = texture2D( tDiffuse, vUv );
    float luminance = linearToRelativeLuminance(texel.rgb * texel.a);
    vec3 diffuse = mix(texel.rgb, vec3(luminance), grayScale);
    gl_FragColor = opacity * vec4(diffuse, texel.a);
}
`
