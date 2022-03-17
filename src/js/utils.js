import TWEEN from "@tweenjs/tween.js";

let passiveSupported = false;
try {
    const options = Object.defineProperty({}, "passive", {
        get: function() {
            passiveSupported = true;
        }
    });
    window.addEventListener("passive-test", null, options);
} catch(err) {
    console.log(err)
}
export const on = (function () {
    if (document.addEventListener) {
        return function (element, event, handler,opts) {
            if (element && event && handler) {
                element.addEventListener(event, handler, passiveSupported ? opts : false);
                return function () {
                    element.removeEventListener(event, handler, passiveSupported ? opts : false);
                }
            }
        };
    } else {
        return function (element, event, handler) {
            if (element && event && handler) {
                element.attachEvent('on' + event, handler);
                return function (element, event, handler) {
                    element.detachEvent('on' + event, handler);
                }
            }
        };
    }
})();
export const off = (function () {
    if (document.removeEventListener) {
        return function (element, event, handler) {
            if (element && event) {
                element.removeEventListener(event, handler, false);
            }
        };
    } else {
        return function (element, event, handler) {
            if (element && event) {
                element.detachEvent('on' + event, handler);
            }
        };
    }
})();

//rgb 编码成 id rgb∈[0,255]
export function RGBToId(color) {
    return (color[0] << 16) | (color[1] << 8) | color[2];
}

//计算曲线点到起点的距离
export function compute2DCurveDisFromStart(points, normalize = false) {
    let dis = [0];
    for (let i = 1; i < points.length; i++) {
        const cur = points[i], before = points[i - 1];
        dis[i] = Math.hypot(cur.x - before.x, cur.y - before.y) + dis[i - 1];
    }
    if (normalize) {
        const total = dis.slice(-1)[0];
        dis = dis.map(i => i / total);
    }
    return dis;
}

export function nodeDragHelper(el, {onPosChange, init, onLeave}) {
    const state = init instanceof Function ? init() : {};
    return on(el, 'pointerdown', e => {
        if (onPosChange({
            e: e,
            type: "start",
            state
        })) {
            const cancel = function () {
                if (cancel._isCancel) return;
                cancel._isCancel = true;
                off1();
                off2();
                off3();
            }
            cancel._isCancel = false;
            const off1 = on(document, 'pointermove', e => {
                onPosChange({
                    e: e,
                    type: "move",
                    state
                });
            });
            const off2 = on(document, 'pointerup', e => {
                onPosChange({
                    e: e,
                    type: "end",
                    state
                })
                cancel();
            });
            const off3 = on(el, 'pointerleave', () => {
                onLeave?.(cancel, state);
            })
        }
    });
}

//更新正交矩阵
export function updateOrthographicCamera({camera, frustumSize, aspect}) {
    camera.left = -frustumSize * aspect;
    camera.right = frustumSize * aspect;
    camera.top = frustumSize;
    camera.bottom = -frustumSize;
    camera.updateProjectionMatrix();
}

//计算范围
export function calcExtent(zoom, center, aspect, frustumSize) {
    const k = 1 / (zoom || 1);
    center = center || [0, 0];
    let ymin = -frustumSize * k,
        ymax = -ymin,
        xmin = ymin * aspect,
        xmax = -xmin;
    xmin += center[0];
    xmax += center[0];
    ymin += center[1];
    ymax += center[1];
    return {
        xmin,
        xmax,
        ymin,
        ymax,
        width: xmax - xmin,
        height: ymax - ymin,
        center: [center[0], center[1]]
    }
}

export class TagSet {
    constructor(name) {
        this.name = name;
        this.tagMap = new Map();
        this.data = [];
        this.set = new Set();
        this.dirty = false;
    }

    add(objs, tag = 'default', effect) {
        if (!tag) throw new Error('tag 不能为空');
        const dataset = this.set, map = this.tagMap;
        let dirty = false;
        effect = effect instanceof Function ? effect : null;
        [].concat(objs).filter(Boolean).forEach(item => {
            if (!map.has(item)) map.set(item, new Set());
            const tagSet = map.get(item);
            tagSet.add(tag);
            if (!dataset.has(item)) {
                dataset.add(item);
                effect?.(item);
                dirty = true;
            }
        });
        this.dirty = this.dirty || dirty;
        return this.dirty;
    }

    clear(tag, effect) {
        let change = false;
        effect = effect instanceof Function ? effect : null;
        if (!tag) {
            change = !!this.set.size;
            this.data = [];
            this.tagMap = new Map();
            effect && Array.from(this.set).forEach(effect)
            this.set.clear();
            this.dirty = false;
        } else {
            change = this.remove(Array.from(this.set), tag, effect);
            this._update();
        }
        return change;
    }

    remove(objs, tag = 'default', effect) {
        if (!tag) throw new Error('tag 不能为空');
        const dataset = this.set, map = this.tagMap;
        let dirty = false;
        effect = effect instanceof Function ? effect : null;
        [].concat(objs).filter(Boolean).forEach(item => {
            const tagSet = map.get(item);
            if (!tagSet) return;
            tagSet.delete(tag);
            if (tagSet.size) return;
            dataset.delete(item);
            effect?.(item);
            dirty = true;
        });
        this.dirty = this.dirty || dirty;
        return this.dirty;
    }

    _update() {
        if (this.dirty) {
            this.data = Array.from(this.set);
            this.dirty = false;
        }
    }

    get(filter) {
        this._update();
        return filter instanceof Function ? this.data.filter(filter) : this.data;
    }

    dispose() {
        this.clear();
    }
}

export class FrameFirer {
    constructor(frameTask) {
        this._task = frameTask;
        this._timer = 0;
    }

    start() {
        if (this._timer) return;
        const step = time => {
            this._task(time);
            this._timer = requestAnimationFrame(step);
        }
        this._timer = requestAnimationFrame(step);
        return this;
    }

    stop() {
        if (!this._timer) return;
        cancelAnimationFrame(this._timer);
        this._timer = 0;
        return this;
    }
}
