import {FullScreenQuad, Pass} from "three/examples/jsm/postprocessing/Pass";
import {CopyShader} from "three/examples/jsm/shaders/CopyShader";
import {ShaderMaterial, UniformsUtils} from "three";
import {GrayFragShader, GrayVertexShader} from "./FilterGray.glsl";

export class GrayFilterPass extends Pass {

    constructor(opacity, grayScale) {

        super();

        const shader = CopyShader;

        this.opacity = (opacity !== undefined) ? opacity : 1.0;
        this.grayScale = (grayScale !== undefined) ? grayScale : 0.0;
        this.uniforms = UniformsUtils.merge([
            shader.uniforms,
            {
                grayScale: {
                    value: 0
                }
            }
        ]);

        this.material = new ShaderMaterial({

            uniforms: this.uniforms,
            vertexShader: GrayVertexShader,
            fragmentShader: GrayFragShader,
            depthTest: false,
            depthWrite: false,
        });

        this.needsSwap = true;

        this.fsQuad = new FullScreenQuad(null);

    }

    render(renderer, writeBuffer, readBuffer) {

        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;

        this.fsQuad.material = this.material;

        this.uniforms['opacity'].value = this.opacity;
        this.uniforms['tDiffuse'].value = readBuffer.texture;
        this.uniforms['grayScale'].value = this.grayScale;

        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        if (this.clear) renderer.clear();
        this.fsQuad.render(renderer);

        renderer.autoClear = oldAutoClear;

    }

}
