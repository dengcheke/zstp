import './style.css'
import TWEEN from "@tweenjs/tween.js";
import {FrameTrigger, KgRenderer} from "@/js/kg-renderer";
import {KgScene} from "@/js/kg-scene";
import {addResizeListener, on} from "@well24/utils";
import throttle from "lodash-es/throttle";
import {Color, MathUtils, Vector2, Vector3} from "three";
import {nodeDragHelper} from "@/js/utils";
import {LabelCanvasRenderer, measureText} from "@/js/label-canvas-renderer";

const PointerAction = Object.freeze({
    none: 0,
    drag: 1,
})

function getTestGraphData() {
    const N = 500;
    let nid = 1;
    let lid = 1;
    const nodeMap = {};
    const nodes = new Array(N).fill(0).map(() => {
        const id = nid++;
        const node = {
            id: id,
            isNode: true,
            attributes: {
                name: "node_" + id
            },
            label: {
                text: "node_" + id,
                color: randomColor()
            },
            style: {
                color: randomColor(),
                size: (Math.random() * 40 >> 0) + 20,
            }
        }
        nodeMap[id] = node;
        return node;
    });
    const links = new Array(N).fill(0).map(() => {
        let s = Math.random() * (N + 1) >> 0 || 1, t = Math.random() * (N + 1) >> 0 || 1;
        if (s === t) return null;
        const res = [];
        const g = randomBoolean();
        let id = lid++;
        const link = {
            id: id,
            source: nodeMap[s],
            target: nodeMap[t],
            isLink: true,
            style: {
                gradient: g,
                color: !g ? randomColor() : null,
                sColor: randomColor(),
                tColor: randomColor(),
                width: (Math.random() * 5 >> 0) + 5,
                flow: randomBoolean()
            },
            label: {
                text: `link${id}(${s}=>${t})`,
                color: randomColor(),
            },
            attributes: {
                name: `link${id}(${s}=>${t})`
            }
        }
        res.push(link);
        for (let i = 1, count = 1 || Math.random() * 5 >> 0; i <= count; i++) {
            const swap = randomBoolean();
            const g = randomBoolean();
            let id = lid++;
            res.push({
                id: id,
                source: nodeMap[swap ? t : s],
                target: nodeMap[swap ? s : t],
                style: {
                    gradient: g,
                    color: !g ? randomColor() : null,
                    sColor: randomColor(),
                    tColor: randomColor(),
                    width: (Math.random() * 5 >> 0) + 5,
                    flow: randomBoolean()
                },
                label: {
                    text: `link${id}(${swap ? t : s}=>${swap ? s : t})`,
                    color: randomColor(),
                },
                attributes: {
                    name: `link${id}(${swap ? t : s}=>${swap ? s : t})`
                },
                isLink: true,
            })
        }
        return res
    }).flat().filter(Boolean)
    return {nodes, links}

    function randomColor() {
        return Math.random() * 0x1000000 >> 0;
    }

    function randomBoolean() {
        return Math.random() > 0.5;
    }
}

function grayFilterAnimation(from, to, {
    dur = 1500,
    easing = TWEEN.Easing.Cubic.Out
} = {}) {
    if (from === to) return;
    const animation = new TWEEN.Tween({t: from});
    const _start = [], _update = [], _complete = [], _stop = [];
    animation.to({t: to}, dur)
        .easing(easing)
        .onStart(() => run(_start))
        .onUpdate(({t}) => run(_update, t))
        .onComplete(() => {
            cancelAnimationFrame(timer);
            animation.stop();
            run(_complete)
        })
        .onStop(() => {
            cancelAnimationFrame(timer);
            TWEEN.remove(animation);
            run(_stop)
        })
    animation.onStart = f => {
        _start.push(f);
        return animation
    }
    animation.onUpdate = f => {
        _update.push(f);
        return animation
    }
    animation.onComplete = f => {
        _complete.push(f);
        return animation
    }
    animation.onStop = f => {
        _stop.push(f);
        return animation
    }
    let timer = 0;
    const step = () => {
        animation.update();
        if (animation.isPlaying()) {
            timer = requestAnimationFrame(step)
        }
    }
    timer = requestAnimationFrame(step);
    return animation;

    function run(arr, ...args) {
        arr.forEach(f => f instanceof Function && f.call(animation, ...args));
    }
}

window.onload = async () => {


    const el = document.body.querySelector('#app');
    const canvas = document.body.querySelector('#graph');
    const labelCanvas = document.body.querySelector('#label');

    const view = new KgRenderer(canvas);
    const labelRenderer = new LabelCanvasRenderer({canvas: labelCanvas});
    const kg = new KgScene();
    kg.addEventListener('after-render', ({tags}) => {
        if (!kg.hasData) return;
        const posChange = [
            FrameTrigger.simulateTick,
            FrameTrigger.control,
            FrameTrigger.resize,
        ].find(reason => tags.has(reason));
        const hlChange = tags.has(FrameTrigger.hlChange);
        const grayChange = tags.has(FrameTrigger.grayFilterChange);
        const {enable, scale} = kg.grayParams;
        if (!(posChange || grayChange || hlChange)) return;

        const hlItems = new Set(kg.hlSet.get());
        const {nodes, links} = kg.graphData;
        const normalAlpha = 0.8;
        const alpha = hlItems.size
            ? MathUtils.clamp(1 - scale * 0.9, 0.1, 0.5)
            : MathUtils.clamp(1 - scale, 0.1, normalAlpha);
        const viewBox = view.state.curExtent;
        nodes.forEach(node => {
            if (!node.labelInfo) node.labelInfo = {};
            const info = node.labelInfo;
            info.worldPosition = [node.x, node.y];
            const text = node.label?.text;
            if (info.text !== text) {
                info.text = text;
                info.size = text ? measureText(text, node.label.font) : null;
            }
        });
        links.forEach(link => {
            if (!link.labelInfo) link.labelInfo = {};
            let info = link.labelInfo;
            const labelPos = link.geometry.labelPos;
            if (!labelPos) return;
            info.worldPosition = [labelPos.x, labelPos.y];  //label世界坐标
            const text = link.label?.text;
            if (info.text !== text) {
                info.text = text;
                info.size = text ? measureText(text, link.label?.font) : null
            }
        });
        const _v2 = new Vector2(), _color = new Color();
        const labels = [nodes, links].flat().map(item => {
            const info = item.labelInfo;
            if (!info || !info.text) return;
            if (!viewBox.containsPoint(_v2.set(info.worldPosition[0], info.worldPosition[1]))) return;
            !item._labelIns && (item._labelIns = {});
            const label = item._labelIns;
            Object.assign(label, {
                name: info.text,
                width: info.size[0],
                height: info.size[1],
                forceShow: hlItems.has(item),
                color: '#' + _color.set("white").multiplyScalar(normalAlpha).getHexString(),
                order: (hlItems.has(item) ? 1000 : 0) + (item.isNode ? 2 : 1)
            });

            if (posChange) {
                const pos = view.worldToScreen(info.worldPosition[0], info.worldPosition[1]);
                label.x = pos.x - info.size[0] * 0.5;
                label.y = pos.y - info.size[1] * 0.5;
            }
            if (enable) {
                if (hlItems.has(item) && item.isNode) {

                } else if (hlItems.has(item) && item.isLink) {
                    label.color = '#' + _color.set("rgb(78,178,255)").multiplyScalar(normalAlpha).getHexString();
                } else {
                    label.color = '#' + _color.set(item.label?.color || "white").multiplyScalar(alpha).getHexString();
                }
            }
            return label
        }).filter(Boolean);
        labelRenderer.drawLabels(labels);
    })
    view.use(kg).setConstraint(kg.constraint);

    //resize listen
    {
        const width = el.clientWidth, height = el.clientHeight;
        view.setSize(width, height);
        addResizeListener(el, throttle(entry => {
            const {contentRect} = entry;
            view.setSize(contentRect.width, contentRect.height);
            labelRenderer.setSize(contentRect.width, contentRect.height);
        }, 200, {leading: false, trailing: true}));
    }

    let curPointerItem = null;
    let curPointerAction = PointerAction.none;
    //hitTest
    {
        let _curAnimation = null, _resetTimer = null;
        on(el, 'pointermove', throttle(event => {
            if (curPointerAction === PointerAction.drag) return;
            if (!view.state.stable) return;
            const scene = view.curScene;
            if (!scene) return;

            const x = event.clientX, y = event.clientY;
            //optimize, 如果之前选中是节点, 检查是否在之前节点范围内,
            if (curPointerItem?.isNode) {
                const cur = curPointerItem;
                const pos = view.worldToScreen(cur.x, cur.y);
                const dis = Math.hypot(pos.x - x, pos.y - y);
                if (dis <= scene.getRenderSizeScale() * cur.style?.size * 0.5) return;
            }

            const beforeHas = !!curPointerItem;
            const item = curPointerItem = view.pick(x, y);
            const curHas = !!item;

            scene.clearHighlight();
            item && scene.highlight(_getRelative(item));

            if (beforeHas !== curHas) {
                if (beforeHas) {
                    _resetTimer = setTimeout(() => _doGrayAnim(0.01), 250);
                } else {
                    clearTimeout(_resetTimer);
                    _doGrayAnim(0.99);
                }
            }

            function _doGrayAnim(to) {
                _curAnimation?.stop();
                _curAnimation = grayFilterAnimation(scene.grayParams.scale, to);
                _curAnimation?.onStart(() => view.curScene?.enableGrayFilter())
                    .onUpdate(t => view.curScene?.setGrayScale(t))
                    .start();
            }

            function _getRelative(item) {
                const items = new Set();
                items.add(item);
                if (item.isNode) {
                    view.curScene.graphData.links.forEach(link => {
                        if (link.target === item || link.source === item) {
                            items.add(link);
                            items.add(link.source);
                            items.add(link.target);
                        }
                    })
                } else {
                    items.add(item.source);
                    items.add(item.target);
                }
                return Array.from(items);
            }
        }, 200, {leading: false, trailing: true}));
    }
    //drag
    {
        const resetNode = (node) => {
            if (!node) return;
            node.x = node.fx || node.x;
            node.y = node.fy || node.y;
            delete node.fx;
            delete node.fy;
        }
        nodeDragHelper(el, {
            init: () => {
                let _offset = new Vector3(),
                    _end = new Vector3();
                return {
                    reset: function () {
                        resetNode(this._curDragNode);
                        curPointerAction = PointerAction.None;
                        this._curDragNode = null;
                        _offset.set(0, 0, 0);
                        _end.set(0, 0, 0);
                    },
                    _curDragNode: null,//当前拖拽点
                    _offset,
                    _end,
                }
            },
            onPosChange: ({e, type, state}) => {
                if (e.button === 2) return false; //右键
                let {_offset, _end} = state;
                const x = e.clientX, y = e.clientY;
                const node = curPointerItem;
                if (node !== state._curDragNode) state.reset();
                if (!node || !node.isNode) return false;
                const scene = view.curScene;
                if (!scene) return false;
                const simulate = scene?.simulate;
                if (type === 'start') {
                    curPointerAction = PointerAction.drag;
                    state._curDragNode = node;
                    node.fx = node.x;
                    node.fy = node.y;
                    const world = view.screenToWorld(x, y)
                    _offset.set(node.x - world.x, node.y - world.y, 0);
                    view.control.noPan = true;
                    return true;// return true to begin drag
                } else if (type === 'move') {
                    let target = simulate.alphaTarget()
                    target = Math.max(target, Math.min(10 / kg.graphData.nodes.length, 0.1));
                    simulate && simulate.alphaTarget(target).restart();
                    _end.addVectors(view.screenToWorld(x, y), _offset);
                    node.fx = _end.x;
                    node.fy = _end.y;
                } else {
                    simulate && simulate.alphaTarget(0);
                    view.control.noPan = false;
                    state.reset();
                }
            },
            onLeave: (cancel, state) => {
                state.reset();
                cancel();
                const simulate = view.curScene?.simulate;
                if (!simulate) return;
                simulate.alphaTarget(0);
            }
        })
    }

    const data = await getTestGraphData();
    kg.setGraphData(data);
}
