import Quadtree from '@timohausmann/quadtree-js'

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
        this.subSampleRatio = 0.25;//减少模板检测数据
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
        const {ctx, canvas} = this;
        const dpr = window.devicePixelRatio;
        const defaultFont = dpr === 1 ? DEFAULT_FONT : DEFAULT_FONT.replace(/\s+(\d+)(px)\s+/g, (...args) => ` ${args[1] * dpr}${args[2]} `);
        labels = labels.sort((b, a) =>
            (a.forceShow ? Infinity : (a.order || 0)) - (b.forceShow ? Infinity : (b.order || 0))
        );
        if (!labels || !labels.length) return;
        const tree = new Quadtree({
            x: 0,
            y: 0,
            width: this.width,
            height: this.height
        });
        labels.forEach((item,idx) => {
            item.__idx = idx;
            item.__pass = 0;// 0待检查, 1已通过, -1未通过
            tree.insert(item)
        });
        for (let i = 0; i < labels.length; i++) {
            const curLabel = labels[i];
            if (curLabel.__pass === -1) continue;
            if (curLabel.forceShow) {
                curLabel.__pass = 1;
                tree.retrieve(curLabel).forEach(item=>{
                    if(item !== curLabel && !item.forceShow){
                        intersect(curLabel, item) && (item.__pass = -1);
                    }
                });
                continue;
            }
            const candidates = tree.retrieve(curLabel);
            let collide = false;
            for (let j = 0; j < candidates.length; j++) {
                const candi = candidates[j];

                const idx = candi.__idx; //candi的元素的索引
                // 如果索引<=i, 说明candi已经检测过了(=i则是自己),无论碰撞与否,
                // 如果candi未通过, 则没必要比较
                // 如果candi已通过, 则必然与当前没有碰撞,(若有碰撞, 当前元素的__pass = -1, 在外层循环就已经跳过)
                if(idx <= i) continue;

                if (curLabel === candi || candi.__pass === -1) continue;
                const _collide = intersect(curLabel, candi);
                if (candi.forceShow || candi.__pass === 1) {
                    if (_collide) {
                        collide = true;
                        break;
                    }
                } else {
                    if (_collide) {
                        candi.__pass = -1;
                    }
                }
            }
            curLabel.__pass = collide ? -1 : 1;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let l = labels.length, i = l - 1; i >= 0; i--) {
            if (labels[i].__pass <= 0) continue;
            const curLabel = labels[i];
            ctx.save();
            let {
                x, y, name, //x,y  左上角
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

        function intersect(a, b) {
            const {x: ax, y: ay, width: aw, height: ah} = a;
            const {x: bx, y: by, width: bw, height: bh} = b;
            const acx = ax + aw * 0.5, acy = ay + ah * 0.5;
            const bcx = bx + bw * 0.5, bcy = by + bh * 0.5;
            return Math.abs(acx - bcx) < (aw + bw) * 0.5 && Math.abs(acy - bcy) < (ah + bh) * 0.5;
        }

    }
}


