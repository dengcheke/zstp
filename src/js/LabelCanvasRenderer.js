import {MathUtils} from "three";

const DEFAULT_FONT = "600 16px serif";
const DEFAULT_FONT_COLOR = "#FFFFFF";

const textCanvas = document.createElement('canvas');
const textCtx = textCanvas.getContext('2d');

/**
 * 测量文本
 * @param text
 * @param font css font
 * @return {(number)[]}  css [width,height]
 */
export function measureText(text, font = DEFAULT_FONT) {
    textCtx.font = font;
    const metric = textCtx.measureText(text);
    return [
        metric.width,
        metric.fontBoundingBoxAscent + metric.fontBoundingBoxDescent
    ]
}


export class LabelCanvasRenderer {
    constructor({width, height, canvas} = {}) {
        this.canvas = canvas || document.createElement("canvas");
        this.ctx = this.canvas.getContext('2d');
        this.subSampleRatio = 0.2;//减少模板检测数据
        this.setSize(width, height);
    }

    //画布宽高
    setSize(width, height) {
        this.width = width || 300;
        this.height = height || 150;
        const w = this.width * this.subSampleRatio >> 0;
        const h = this.height * this.subSampleRatio >> 0;
        this.stencil = new Uint8ClampedArray(w * h);
        this.stencil.size = [w, h];
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        return this;
    }

    drawLabels(labels) {
        const {ctx, canvas} = this, self = this;
        const dpr = window.devicePixelRatio;
        const defaultFont = dpr === 1 ? DEFAULT_FONT : DEFAULT_FONT.replace(/\s+(\d+)(px)\s+/g,(...args)=> ` ${args[1]*dpr}${args[2]} `);
        labels = labels.sort((b, a) =>
            (a.forceShow ? Infinity : (a.order || 0)) - (b.forceShow ? Infinity : (b.order || 0))
        );
        if (!labels || !labels.length) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const stencil = this.stencil;
        stencil.fill(0);

        const showFlag = new Uint8Array(labels.length).fill(1);
        //stencil test
        for (let i = 0; i < labels.length; i++) {
            const curLabel = labels[i];
            if (i === 0 || curLabel.forceShow) {
                writeStencil(curLabel)
            } else {
                const collide = checkCollide(curLabel);
                if (collide) {
                    showFlag[i] = 0;
                } else {
                    writeStencil(curLabel)
                }
            }
        }
        //renderStencil();
        for (let l = labels.length, i = l - 1; i >= 0; i--) {
            if (!showFlag[i]) continue;
            const curLabel = labels[i];
            ctx.save();
            let {
                x, y, name,
                width, height,
                font = defaultFont,
                color = DEFAULT_FONT_COLOR,
            } = curLabel;
            if (width === undefined || height === undefined) {
                [width, height] = measureText(name, font);
            }
            ctx.font = font;
            ctx.fillStyle = color;
            ctx.fillText(name, x * dpr, (y + height) * dpr)
            ctx.restore();
        }

        function checkCollide(label) {
            const r = self.subSampleRatio, size = self.stencil.size;
            let {width, height, x, y} = label;
            x = x * r >> 0;
            y = y * r >> 0;
            width = width * r >> 0;
            height = height * r >> 0;
            let f = 0;
            for (let row = y; row < y + height; row++) {
                for (let col = x; col < x + width; col++) {
                    f |= stencil[row * size[0] + col];
                    if (f) return true;
                }
            }
            return false;
        }

        function writeStencil(label) {
            const r = self.subSampleRatio, size = self.stencil.size;
            let {width, height, x, y} = label;
            x = x * r >> 0;
            y = y * r >> 0;
            width = width * r >> 0;
            height = height * r >> 0;
            const rows = MathUtils.clamp(y + height, 0, size[1]);
            const cols = MathUtils.clamp(x + width, 0, size[0]);
            for (let row = y; row < rows; row++) {
                for (let col = x; col < cols; col++) {
                    stencil[row * size[0] + col] = 1;
                }
            }
        }

        function renderStencil() {
            const stencil = self.stencil;
            const size = stencil.size;
            const data = new Uint8ClampedArray(size[0] * size[1] * 4).fill(255)
            for (let i = 0; i < size[0] * size[1]; i++) {
                data[i * 4] =
                    data[i * 4 + 1] =
                        data[i * 4 + 2] = stencil[i] * 255;
            }
            ctx.putImageData(new ImageData(data, size[0], size[1]), 0, 0)
        }

    }
}


