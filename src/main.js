import './style.css'
import {FrameTrigger, GraphRenderContext, GraphScene} from "@/js/ZstpGraph";
import {LabelCanvasRenderer, measureText} from "@/js/LabelCanvasRenderer";
import {FrameSchdEvent} from "@/js/GraphUtils";
import {Color, MathUtils, Vector2, Vector3} from "three";
import debounce from "lodash/debounce";
import throttle from "lodash/throttle";
import TWEEN from "@tweenjs/tween.js";
import {nodeDragHelper, on} from "@/js/utils";

const PointerAction = Object.freeze({
    None: 0,
    Drag: 1,
});

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
                flow: false,//randomBoolean()
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
                    flow: false,//randomBoolean()
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


window.onload = () => {
    const wrapper = document.body.querySelector('#app');
    const canvas = document.body.querySelector('#graph');
    const labelCanvas = document.body.querySelector('#label');

    //init
    const width = window.innerWidth, height = window.innerHeight;
    const renderCtx = new GraphRenderContext(canvas);
    const scheduler = renderCtx.scheduler;
    const scene = new GraphScene("main");

    //labels
    const labelCanvasRenderer = new LabelCanvasRenderer({canvas: labelCanvas});
    renderCtx.addEventListener('resize', ({state}) => {
        labelCanvasRenderer.setSize(state.width, state.height);
    });
    scheduler.addEventListener(FrameSchdEvent.render, ({tags}) => {
        if (!scene.hasData) return;
        const posChange = [
            FrameTrigger.simulateTick,
            FrameTrigger.control,
            FrameTrigger.resize,
        ].find(reason => tags.has(reason));
        const hlChange = tags.has(FrameTrigger.hlChange);
        const grayChange = tags.has(FrameTrigger.grayFilterChange);
        const {enable, scale} = scene.grayParams;
        if (!(posChange || grayChange || hlChange)) return;

        const hlItems = new Set(scene.hlSet.get());
        const {nodes, links} = scene.graphData;
        const normalAlpha = 0.8;
        const alpha = hlItems.size
            ? MathUtils.clamp(1 - scale * 0.9, 0.1, 0.5)
            : MathUtils.clamp(1 - scale, 0.1, normalAlpha);
        const viewBox = renderCtx.state.curExtent;
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
                const pos = renderCtx.worldToScreen(info.worldPosition[0], info.worldPosition[1]);
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
        labelCanvasRenderer.drawLabels(labels);
    })

    //events
    on(window, 'resize', debounce(() => {
        const w = window.innerWidth, h = window.innerHeight;
        renderCtx.setSize(w, h);
    }, 100, {leading: false, trailing: true}))
    //call once at init
    renderCtx.setSize(width, height);

    //actions
    scene.enableGrayFilter();
    let _curAnimation = null, _timer = null;
    let curPointerItem = null, curPointerAction = PointerAction.None;
    on(wrapper,'pointermove', throttle(event => {
        if (curPointerAction === PointerAction.Drag) return;
        if (renderCtx.state.stable) {
            const x = event.clientX, y = event.clientY;
            if (curPointerItem?.isNode) {
                const cur = curPointerItem;
                const pos = renderCtx.worldToScreen(cur.x, cur.y);
                const dis = Math.hypot(pos.x - x, pos.y - y);
                if (dis <= scene.getRenderSizeScale() * (cur.style?.size || 10) * 0.5) return;
            }
            const before = !!curPointerItem;
            scene.clearHighlight();
            const item = curPointerItem = scene.pick(x, y) || null;
            const cur = !!item;

            if (item) {
                const items = new Set();
                items.add(item);
                if(item.isNode){
                    scene.graphData.links.forEach(link => {
                        if (link.target === item || link.source === item) {
                            items.add(link);
                            items.add(link.source);
                            items.add(link.target);
                        }
                    })
                }else{
                    items.add(item.source);
                    items.add(item.target);
                }
                scene.highlight(Array.from(items));
            }
            if (before !== cur) {
                if (before) {
                    _timer = setTimeout(() => _doGrayAnim(0), 400)
                } else {
                    clearTimeout(_timer);
                    _doGrayAnim(1);
                }
            }

            function _doGrayAnim(to) {
                _curAnimation?.stop();
                _curAnimation = grayFilterAnimation(scene.grayParams.scale, to);
                _curAnimation?.onUpdate(t => scene.setGrayScale(t)).start();
            }
        }
    }, 200, {leading: false, trailing: true}))
    on(wrapper,'pointerleave', () => {
        if (curPointerItem) {
            scene.clearHighlight();
        }
        curPointerItem = null;
    });
    const resetNode = (node) => {
        if (!node) return;
        node.x = node.fx || node.x;
        node.y = node.fy || node.y;
        delete node.fx;
        delete node.fy;
    }
    //drag
    nodeDragHelper(wrapper, {
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
            if (!node || !node.isNode) return;
            const simulate = renderCtx.curScene?.simulate;
            if (type === 'start') {
                curPointerAction = PointerAction.drag;
                state._curDragNode = node;
                node.fx = node.x;
                node.fy = node.y;
                const world = renderCtx.screenToWorld(x, y)
                _offset.set(node.x - world.x, node.y - world.y, 0);
                return true;// return true to begin drag
            } else if (type === 'move') {
                let target = simulate.alphaTarget()
                target = Math.max(target, Math.min(10 / scene.graphData.nodes.length, 0.1));
                simulate && simulate.alphaTarget(target).restart();
                _end.addVectors(renderCtx.screenToWorld(x, y), _offset);
                node.fx = _end.x;
                node.fy = _end.y;
            } else {
                simulate && simulate.alphaTarget(0);
                state.reset();
            }
        },
        onLeave: (cancel, state) => {
            state.reset();
            cancel();
            const simulate = renderCtx.curScene?.simulate;
            if (!simulate) return;
            simulate.alphaTarget(0);
        }
    });


    //set data
    renderCtx.switchScene(scene);
    renderCtx.applyConstraint(scene.constraint);
    const data = getTestGraphData();
    const infoDiv = document.body.querySelector('#info');
    infoDiv.innerHTML = `<p>nodes:${data.nodes.length}</p><p>links:${data.links.length}</p>`
    scene.setGraphData(data);
}
