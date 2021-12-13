import {
    Box2,
    BufferGeometry,
    Color,
    CustomBlending,
    DynamicDrawUsage,
    Float32BufferAttribute,
    InstancedBufferAttribute,
    MathUtils,
    NoBlending,
    OneMinusSrcAlphaFactor,
    OrthographicCamera,
    Points,
    QuadraticBezierCurve,
    Scene,
    ShaderMaterial,
    SrcAlphaFactor,
    StaticDrawUsage,
    Vector2,
    Vector3,
    WebGLRenderer,
    WebGLRenderTarget
} from "three";
import {CustomTrackballControls} from "./CustomTrackballControls";
import {forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY} from "d3-force";
import {LineSegments2} from "three/examples/jsm/lines/LineSegments2";
import {LineSegmentsGeometry} from "three/examples/jsm/lines/LineSegmentsGeometry";
import {FrameFirer, FrameSchdEvent, FrameScheduler, TagSet} from "./GraphUtils";
import {linkFragShader, linkVertexShader} from "./glsl/Link.glsl";
import {forceBound, ForceBoundType} from "./ForceBound";
import {DefaultLinkColor, DefaultLinkWidth, DefaultNodeColor, DefaultNodeSize} from "./config";
import {EventDispatcher} from "./EventDispatcher";
import {compute2DCurveDisFromStart, RGBToId} from "@/js/GraphUtils";
import isObject from 'lodash/isObject'
import {NodeFragShader, NodeVertexShader} from "@/js/glsl/Node.glsl";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass";
import {GrayFilterPass} from "@/js/GrayFilterPass";

const _color = new Color();
const _vec3 = new Vector3();
const _vec2 = new Vector2();
const _box2 = new Box2();
const _2dBzrCurve = new QuadraticBezierCurve();
export const RenderOrder = Object.freeze({
    Polygon: 100,
    Polyline: 200,
    Point: 300,
})
const DEFAULT_CONSTRAINT = Object.freeze({
    minZoom: 0.001,
    maxZoom: Infinity,
    frustumSize: 1,
})
export const FrameTrigger = Object.freeze({
    control: 'control', //可视化范围改变, 平移缩放等
    simulateTick: 'simulateTick', //模拟过程
    resize: 'resize',
    hlChange: 'hlChange',
    appearChange: 'appearChange',
    flowLinkAnimation: 'flowLinkAnimation',
    grayFilterChange: 'grayFilterChange',
})

export class GraphRenderContext extends EventDispatcher {
    constructor(
        canvas = document.createElement('canvas'),
        scheduler = new FrameScheduler()
    ) {
        super();
        this._initialized = false;
        this.scheduler = scheduler;
        this.state = {
            dpr: window.devicePixelRatio,
            width: 300,
            height: 150,
            aspect: 2,
            stable: true,
            resolution: null,
            fullExtent: null, //整个范围(world coord)
            viewExtent: null, //当前可视范围(world coord)
        }
        this.constraint = {...DEFAULT_CONSTRAINT};
        this.curScene = null;
        this.init(canvas);
    }

    init(canvas) {
        if (this._initialized) return;
        const renderer = new WebGLRenderer({
            canvas, antialias: true, alpha: true
        });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor('rgb(0,0,0)');
        renderer.setClearAlpha(0);

        const camera = new OrthographicCamera();
        camera.near = 0;
        camera.minDistance = 1;
        camera.position.set(0, 0, 2000);
        camera.lookAt(0, 0, -1);
        camera.updateProjectionMatrix();

        const control = new CustomTrackballControls(camera, canvas);

        control.noRotate = true;
        control.addEventListener('change', () => {

            this.scheduler.requestFrame(FrameTrigger.control);
        });
        let _stableTimer = 0, smooth = new FrameFirer(() => {
            this.scheduler.requestFrame(FrameTrigger.control);
        });
        control.addEventListener('start', () => {
            this.state.stable = false;
            clearTimeout(_stableTimer);
            smooth.start();
        });
        control.addEventListener('end', () => {
            clearTimeout(_stableTimer);
            _stableTimer = setTimeout(() => {
                this.state.stable = true;
                smooth.stop();
            }, 300)
        });


        this.scheduler.addEventListener(FrameSchdEvent.frameStart, () => {
            control.update();
            this.state.curExtent = this.control.curExtent;
            //1 pixel = x world unit
            this.state.resolution = (camera.top - camera.bottom) / this.state.height;
        });
        this.scheduler.addEventListener(FrameSchdEvent.render, ({tags}) => {
            this.curScene?.render({ctx: this, tags});
        });
        Object.assign(this, {camera, canvas, control, renderer});
        this._initialized = true;
        return this;
    }

    setSize(w, h) {
        const {state, renderer, canvas} = this;
        state.aspect = w / h;
        state.width = w;
        state.height = h;
        this._updateWithConstraint();
        if (canvas.width !== w || canvas.height !== h) {
            renderer.setSize(w, h, false);
            this.scheduler.requestFrame(FrameTrigger.resize);
        }
        this.dispatchEvent({type: 'resize', state})
        return this;
    }

    _updateWithConstraint() {
        updateOrthographicCamera({
            camera: this.camera,
            frustumSize: this.constraint.frustumSize,
            aspect: this.state.aspect
        })
        this.control.applyOrthographicConstrain2D(
            this.constraint,
            this.state.aspect
        );
        this.state.fullExtent = this.control.fullExtent;

        function updateOrthographicCamera({camera, frustumSize, aspect}) {
            camera.left = -frustumSize * aspect;
            camera.right = frustumSize * aspect;
            camera.top = frustumSize;
            camera.bottom = -frustumSize;
            camera.updateProjectionMatrix();
        }
    }

    applyConstraint(constraint) {
        this.constraint = constraint || {...DEFAULT_CONSTRAINT};
        this._updateWithConstraint();
    }

    //切换场景
    switchScene(newScene) {
        if (newScene === this.curScene) return;
        this.curScene?.deactive();
        this.curScene = newScene;
        newScene?.active(this);
        this.scheduler.requestFrame(FrameTrigger.control);
        return this;
    }

    //transform
    /**
     * 屏幕坐标转 ndc
     * @param x 相对于canvas左上角的 x坐标
     * @param y 相对于canvas左上角的 y坐标
     * @returns {Vector2}
     */
    screenPosToNDC(x, y) {
        const state = this.state;
        const width = state.width,
            height = state.height;
        return new Vector2(
            2 * x / width - 1,
            -2 * y / height + 1
        )
    }

    /**
     * 屏幕坐标转世界坐标
     * @param x 相对于canvas左上角的 x坐标
     * @param y 相对于canvas左上角的 y坐标
     * @returns {Vector3}
     */
    screenToWorld(x, y) {
        const ndc = this.screenPosToNDC(x, y);
        return new Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
    }

    ndcToScreenPos(ndcX, ndcY) {
        const state = this.state;
        const width = state.width,
            height = state.height;
        return new Vector2(
            (ndcX + 1) * width / 2,
            (ndcY - 1) * height / -2
        )
    }

    worldToScreen(worldX, worldY, worldZ) {
        const ndc = _vec3.set(worldX, worldY, worldZ || 0).project(this.camera);
        return this.ndcToScreenPos(ndc.x, ndc.y);
    }

    dispose() {
        this.renderer.dispose();
        this.control.dispose();
    }
}

const BufferUpdateFlag = Object.freeze({
    dataChange: 'dataChange',//数据改变
    geometryChange: 'geometryChange',//几何位置改变
    nodeAppearChange: 'nodeAppearChange', //node 外观变化
    linkAppearChange: 'linkAppearChange', //link 颜色变化, 宽度等,
    nodeVisibleChange: 'nodeVisibleChange', //node 是否可见
    linkVisibleChange: 'linkVisibleChange', //link 是否可见,
    hlChange: 'hl-change'
})
//vshow=-1; visible = false; 所有情况下不显示
//vshow=0; normal 不显示, toggle 显示
//vshow=1; normal 显示, toggle 不显示
const ShowMode = Object.freeze({
    normal: 1,
    toggle: 2
})

export class GrayScaleComposer {
    constructor(renderer) {
        const composer = new EffectComposer(renderer);
        const renderPass = new RenderPass();
        const grayPass = new GrayFilterPass();
        grayPass.renderToScreen = true;
        composer.addPass(renderPass);
        composer.addPass(grayPass);
        Object.assign(this, {
            composer,
            renderPass,
            grayPass
        })
    }

    dispose() {
        const {renderTarget1, renderTarget2} = this.composer;
        renderTarget2?.dispose();
        renderTarget1?.dispose();
    }

    setSize(width, height) {
        if (width !== this.composer._width || height !== this.composer._height)
            this.composer.setSize(width, height)
    }
}

export class GraphScene extends EventDispatcher {
    constructor(name) {
        super();
        this._ticks = 0;
        this._gid = 1;

        this.name = name;
        this.hasData = false;
        this.isActive = false;
        this.updateFlag = new Set();

        this.grayParams = {
            enable: false,
            scale: 0,
            _change: false, //scale值 是否变化
        }
        this.hlSet = new TagSet('highlight');//高亮
        this.constraint = {
            minZoom: 0.5,
            maxZoom: 6,
            frustumSize: 1000,
        };
        this.renderCtx = null;

        this.graphData = null;
        this.dataExtent = new Box2();

        let geoChange = false;
        this.simulate = forceSimulation()
            .force('x', forceX().strength(0.01))
            .force('y', forceY().strength(0.01))
            .force('collision', forceCollide().radius(80))
            .force('link', forceLink().distance(200))
            .force('charge', forceManyBody().strength(-30))
            .force('bounding', forceBound({
                type: ForceBoundType.radial,
                radius: 1000,
            }))
            .on('tick', () => {
                if (!this.hasData) return;
                this._ticks++;
                geoChange = true;
                this.dataExtent.makeEmpty().setFromPoints(this.graphData.nodes);
                this.updateFlag.add(BufferUpdateFlag.geometryChange);
                this.requestFrame(FrameTrigger.simulateTick);
            })
            .stop()
        this.addEventListener('before-render', function updateGeometry({ctx, tags}) {
            if (!this.hasData) return;
            const viewChange = tags.has(FrameTrigger.control);
            if (geoChange || viewChange) {
                const needUpdate = geoChange || this.graphData.links.find(i => i.geometry?._version !== this._ticks);
                if (needUpdate) {
                    this.updateFlag.add(BufferUpdateFlag.linkVisibleChange);
                    computeGeometry.call(this, ctx);
                }
                geoChange = false;
            }

            function computeGeometry(ctx) {
                const state = ctx.state;
                const version = this._ticks;
                const {nodes, links} = this.graphData;
                const dataBox = this.dataExtent;
                const viewBox = state.curExtent;
                const intersect = dataBox.intersectsBox(viewBox);
                if (!intersect) return;
                const scale = this.getRenderSizeScale() * state.resolution;
                let tempBox = _box2;
                nodes.forEach(node => {
                    const offset = node.size * scale * 0.5;
                    _vec2.set(offset, offset);
                    tempBox.copy(viewBox).expandByVector(_vec2, _vec2);
                    node._inbound = tempBox.containsPoint(_vec2.set(node.x, node.y));
                });
                let flag = false, linkBox = _box2;
                links.forEach(link => {
                    link._tempVisible = true;//标记临时未更新对象不可见
                    if (link.visible === false) return;
                    if (link.geometry._version === version) return;//数据已经是最新的
                    //不是最新的，在可视范围就更新（当前tick不可见），否则等到下次在可视范围内在更新
                    calcLinkLayout(link);
                    if (link.target._inbound || link.source._inbound) {
                        //任意一点可见, link可见
                        link._inbound = true;
                        flag = calcLinkPoints(link) || flag;
                    } else {
                        if (link.geometry.pointCount === 2) {
                            link._inbound = false;
                            link._tempVisible = false;
                            return;
                        }
                        //计算当前状态包围盒
                        calcLinkBox(link, linkBox);
                        if (viewBox.intersectsBox(linkBox)) {
                            link._inbound = true;
                            flag = calcLinkPoints(link) || flag;
                        } else {
                            link._inbound = false;
                            link._tempVisible = false;
                        }
                    }
                });
                flag && this.updateFlag.add(BufferUpdateFlag.geometryChange);

                function calcLinkLayout(link) {
                    if (!geoChange) return;
                    const {source, target, geometry} = link;
                    const v2 = _vec2,
                        control = new Vector2(),
                        middle = new Vector2(),
                        labelPos = new Vector2();
                    v2.set((target.x - source.x) || 1e-6, (target.y - source.y) || 1e-6);
                    const dis = v2.length(); //起点到终点距离
                    geometry.width = dis;
                    v2.normalize();
                    geometry.dir = new Vector2().copy(v2);//单位方向向量
                    v2.rotateAround({x: 0, y: 0}, Math.PI * 0.5 * (geometry.clockwise ? -1 : 1))
                        .multiplyScalar(geometry.cFactor * dis * 0.3);
                    geometry.height = v2.length() * 0.5;
                    labelPos.copy(v2).multiplyScalar(0.5);//标签位置
                    middle.set(target.x + source.x, target.y + source.y).multiplyScalar(0.5);
                    v2.add(middle);
                    labelPos.add(middle).floor();
                    Object.assign(link.geometry, {
                        middle: middle,//中点
                        controlPoint: control.copy(v2),//控制点
                        labelPos: labelPos
                    })
                }

                function calcLinkPoints(link) {
                    if (link.geometry._version === version) return;
                    const {source, target, geometry, symmetryLink} = link;
                    const curve = _2dBzrCurve;
                    curve.v0.set(source.x, source.y);
                    curve.v1.copy(geometry.controlPoint);
                    curve.v2.set(target.x, target.y);
                    const points = curve.getPoints(geometry.pointCount - 1);
                    let distances;
                    {
                        if (symmetryLink && symmetryLink.geometry._version === version) {
                            //对称线无须重复计算
                            distances = symmetryLink.geometry.distances;
                        } else {
                            distances = compute2DCurveDisFromStart(points, true);
                        }
                    }
                    Object.assign(link.geometry, {
                        points,//曲线点数组
                        distances,//曲线点距起点距离数组,归一化
                        totalDis: distances.slice(-1)[0],//1
                        _version: version
                    })
                    return true;
                }

                function calcLinkBox(link, outBox) {
                    const {geometry} = link;
                    const {width, height, dir} = geometry;
                    const cos = dir.x / width, sin = dir.y / width;
                    let xmin = 0, xmax = width, ymin = 0, ymax = height;
                    [
                        [0, height],
                        [width, height],
                        [width, 0]
                    ].forEach(point => {
                        const x = point[0], y = point[1];
                        const x1 = x * cos - y * sin
                        const y1 = x * sin + y * cos
                        xmin = Math.min(xmin, x1);
                        xmax = Math.max(xmax, x1);
                        ymin = Math.min(ymin, y1);
                        ymax = Math.max(ymax, y1);
                    });
                    outBox.min.x = xmin;
                    outBox.max.x = xmax;
                    outBox.min.y = ymin;
                    outBox.max.y = ymax;
                    outBox.translate(link.source);
                }
            }
        }.bind(this))
        this._initSceneAndObj();
        this.addEventListener('before-render', function checkHasLinkAnimation() {
            if (!this.hasData) return;
            const flow = this.graphData?.links.find(link => link.style?.flow);
            if (flow) {
                this.linkAnimation.start();
            } else {
                this.linkAnimation.stop();
            }
        }.bind(this));
    }

    getRenderSizeScale() {
        if (!this.renderCtx) return 1;
        const {camera} = this.renderCtx;
        return MathUtils.clamp(camera.zoom, 0.5, 1)
    }

    getGrayComposer() {
        const ctx = this.renderCtx;
        if (!ctx) throw new Error('renderCtx not exist, active this scene first');
        if (!this.grayScaleComposer) {
            this.grayScaleComposer = new GrayScaleComposer(this.renderCtx.renderer);
            this.grayScaleComposer._off = ctx.addEventListener('resize', ({state}) => {
                this.grayScaleComposer.setSize(state.width, state.height);
            })
        }
        return this.grayScaleComposer;
    }

    setGraphData(data) {
        this._gid = 1;
        this._ticks = 0;
        this.dataExtent.makeEmpty();

        let {nodes = [], links = []} = data || {};
        this.graphData = {nodes, links};
        this.hasData = !!(links.length + nodes.length);
        if (!this.hasData) return;
        nodes.forEach(node => node._gid = this._gid++);
        links.forEach(link => {
            link._gid = this._gid++;
            ['source', 'target'].forEach(key => {
                if (!isObject(link[key])) {
                    link[key] = nodes.find(node => node.id === link[key]);
                }
            })
        });
        const simulateLinks = preprocess(links) || [];
        this.updateFlag.add(BufferUpdateFlag.dataChange);
        this.requestFrame('data-change')
        this.simulate.stop()
            .nodes(nodes)
            .force('link').links(simulateLinks);
        this.simulate.restart();
        return this;

        //分组,计算布局，优化
        function preprocess(links) {
            if (!links?.length) return;
            const linkMap = new Map();
            const simulateLinks = []; //模拟用的link, 同一对 source <=> target 只取一条
            for (let i = 0, len = links.length; i < len; i++) {
                const link = links[i];
                const source = link.source, target = link.target;
                if (linkMap.get(source) === target || linkMap.get(target) === source) continue;
                simulateLinks.push(link);
                linkMap.set(source, target);
                linkMap.set(target, source);
                const forward = links.filter(l => {
                    if (l.source === source && l.target === target) {
                        getGeometry(l).direction = 1;
                        return true;
                    }
                });
                const reverse = links.filter(l => {
                    if (l.source === target && l.target === source) {
                        getGeometry(l).direction = 0;
                        return true;
                    }
                });
                const group = [forward, reverse].flat();
                const halfIndex = (group.length - 1) / 2;
                for (let i = 0, len = group.length; i < len; i++) {
                    const item = group[i];
                    const geo = getGeometry(item)
                    if (i === halfIndex) { //中间线，直线
                        geo.cFactor = 0; //控制点径向距离比例
                        geo.pointCount = 2;
                    } else { //两边曲线
                        geo.cFactor = Math.ceil(Math.abs(i - halfIndex)) //控制点径向距离比例
                        geo.pointCount = 40;
                    }
                    if ((geo.direction && i > halfIndex)
                        || (!geo.direction && i < halfIndex)
                    ) {
                        geo.clockwise = false;
                    } else {
                        geo.clockwise = true; //顺时针
                    }
                    geo.flowOffset = Math.random() * 0.5;
                }
                group.forEach(child => {
                    child.symmetryLink = group.find(i => i !== child
                        && i.geometry.cFactor === child.geometry.cFactor)
                })
            }
            return simulateLinks;
        }

        function getGeometry(link) {
            if (link.geometry === undefined) link.geometry = {};
            return link.geometry;
        }
    }

    _initSceneAndObj() {
        const scene = new Scene();
        const nodesMat = new ShaderMaterial({
            blending: CustomBlending,
            blendSrc: SrcAlphaFactor,
            blendDst: OneMinusSrcAlphaFactor,
            depthTest: false,
            uniforms: {
                scale: {value: 1},
                isPick: {value: false},
                showMode: {value: ShowMode.normal}
            },
            vertexShader: NodeVertexShader,
            fragmentShader: NodeFragShader
        });
        const nodesObj = new Points(new BufferGeometry(), nodesMat);
        nodesObj.renderOrder = RenderOrder.Point;
        nodesObj.frustumCulled = false;
        const linkMat = new ShaderMaterial({
            blending: CustomBlending,
            blendSrc: SrcAlphaFactor,
            blendDst: OneMinusSrcAlphaFactor,
            transparent: false,
            depthTest: false,
            depthWrite: false,
            vertexShader: linkVertexShader,
            fragmentShader: linkFragShader,
            uniforms: {
                lineWidthScale: {value: 1},
                minAlpha: {value: 0.3},
                isPick: {value: false},
                uTrail: {
                    value: {
                        speed: 0.2,
                        length: 0.35,
                        cycle: 0.5,
                    }
                },
                showMode: {value: ShowMode.normal},
                time: {value: 0},
                resolution: {value: new Vector2(window.innerWidth, window.innerHeight)}
            }
        });
        const linksObj = new LineSegments2(new LineSegmentsGeometry(), linkMat);
        linksObj.renderOrder = RenderOrder.Polyline;
        linksObj.frustumCulled = false;
        this.linkAnimation = new FrameFirer(() => {
            linkMat.uniforms.time.value = performance.now() / 1000;
            this.requestFrame(FrameTrigger.flowLinkAnimation);
        })
        scene.add(nodesObj, linksObj);
        this.addEventListener('dispose', () => {
            [nodesObj, linksObj].map(({geometry, material}) => {
                geometry.dispose();
                material.dispose();
            })
        })
        Object.assign(this, {
            scene, nodesObj, linksObj
        });
    }

    active(renderCtx) {
        if (!renderCtx) return;
        const {scheduler} = renderCtx;
        this._off = scheduler.addEventListener(FrameSchdEvent.beforeRender, ({tags}) => {
            this.dispatchEvent({
                type: 'before-render',
                ctx: renderCtx,
                tags
            });
        });
        this.renderCtx = renderCtx;
        this.hasData && this.simulate.restart();
        this.isActive = true;
    }

    deactive() {
        this._off();
        this.renderCtx = null;
        this.linkAnimation?.stop();
        this.simulate.stop();
        this.isActive = false;
    }

    _markFlag(flag) {
        this.updateFlag.add(flag);
    }

    _updateNodeBufferData(decideShow) {
        const {nodesObj, graphData, updateFlag} = this;
        if (!graphData) return;
        const dataChange = updateFlag.has(BufferUpdateFlag.dataChange),
            geoChange = dataChange || updateFlag.has(BufferUpdateFlag.geometryChange),
            appearChange = dataChange || updateFlag.has(BufferUpdateFlag.nodeAppearChange),
            visibleChange = dataChange || appearChange || updateFlag.has(BufferUpdateFlag.nodeVisibleChange)
                || updateFlag.has(BufferUpdateFlag.hlChange);
        const {nodes} = graphData;
        if (dataChange) {
            nodesObj.geometry.dispose();//dispose before
            const geometry = nodesObj.geometry = new BufferGeometry();
            const nodeCount = nodes.length;
            [
                {name: 'position', usage: DynamicDrawUsage, itemSize: 3},
                {name: 'visible', usage: DynamicDrawUsage, itemSize: 1},
                {name: 'size', usage: StaticDrawUsage, itemSize: 1},
                {name: 'color', usage: StaticDrawUsage, itemSize: 3},
                {name: 'pickId', usage: StaticDrawUsage, itemSize: 1},
            ].forEach(({name, usage, itemSize}) => {
                const attr = new Float32BufferAttribute(new Float32Array(itemSize * nodeCount), itemSize);
                attr.setUsage(usage).name = name;
                geometry.setAttribute(name, attr);
            });
        }
        if (dataChange || geoChange || appearChange || visibleChange) {
            const geometry = nodesObj.geometry;
            const posBuf = geometry.getAttribute('position').array,
                colorBuf = geometry.getAttribute('color').array,
                sizeBuf = geometry.getAttribute('size').array,
                pickIdBuf = geometry.getAttribute('pickId').array,
                visibleBuf = geometry.getAttribute('visible').array;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (dataChange || visibleChange) {
                    let visible;
                    if (node.visible === false) {
                        visible = -1;
                    } else {
                        visible = decideShow instanceof Function
                            ? decideShow({node: node})
                            : 1 //默认可见
                    }
                    visibleBuf[i] = visible;
                }
                const style = node.style || {};
                if (dataChange || geoChange) {
                    posBuf[i * 3] = node.x;
                    posBuf[i * 3 + 1] = node.y;
                }
                if (dataChange) {
                    pickIdBuf[i] = node._gid;
                }
                if (dataChange || appearChange) {
                    sizeBuf[i] = style.size || DefaultNodeSize;
                    _color.set(style.color || DefaultNodeColor)
                    colorBuf[i * 3] = _color.r;
                    colorBuf[i * 3 + 1] = _color.g;
                    colorBuf[i * 3 + 2] = _color.b;
                }

            }

            if (geoChange || dataChange) {
                geometry.getAttribute('position').needsUpdate = true;
            }
            if (appearChange || dataChange) {
                geometry.getAttribute('color').needsUpdate = true;
                geometry.getAttribute('size').needsUpdate = true;
            }
            if (dataChange) {
                geometry.getAttribute('pickId').needsUpdate = true;
            }
            if (dataChange || visibleChange) {
                geometry.getAttribute('visible').needsUpdate = true;
            }
        }
    }

    _updateLinkBufferData(decideShow) {
        const {linksObj, graphData, updateFlag} = this;
        if (!graphData) return;
        const dataChange = updateFlag.has(BufferUpdateFlag.dataChange),
            geoChange = dataChange || updateFlag.has(BufferUpdateFlag.geometryChange),
            appearChange = dataChange || updateFlag.has(BufferUpdateFlag.linkAppearChange),
            visibleChange = dataChange || appearChange || updateFlag.has(BufferUpdateFlag.linkVisibleChange)
                || updateFlag.has(BufferUpdateFlag.hlChange);
        const change = dataChange || geoChange || appearChange || visibleChange;
        const {links} = graphData;
        const segmentCount = links.reduce((total, link) => {
            total += link.geometry.pointCount - 1;
            return total;
        }, 0);
        if (change) {
            //reset geometry
            if (dataChange) {
                linksObj.geometry.dispose();
                const geometry = linksObj.geometry = new LineSegmentsGeometry();
                [
                    //dynamic
                    {name: "instanceStart", itemSize: 3, usage: DynamicDrawUsage},
                    {name: "instanceEnd", itemSize: 3, usage: DynamicDrawUsage},
                    {name: "instanceDisStart", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceDisEnd", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceVisible", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceLineWidth", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceFlowEnable", itemSize: 1, usage: DynamicDrawUsage},
                    //static
                    {name: "instanceLineColorStart", itemSize: 3, usage: StaticDrawUsage},
                    {name: "instanceLineColorEnd", itemSize: 3, usage: StaticDrawUsage},
                    {name: "instanceLineDisOffset", itemSize: 1, usage: StaticDrawUsage},
                    {name: "instancePickId", itemSize: 1, usage: StaticDrawUsage},
                ].forEach(({name, itemSize, usage}) => {
                    const attr = new InstancedBufferAttribute(new Float32Array(segmentCount * itemSize), itemSize);
                    attr.setUsage(usage).name = name;
                    geometry.setAttribute(name, attr);
                })
            }

            //update buffer data
            const geometry = linksObj.geometry;
            const posStartBuf = geometry.getAttribute('instanceStart').array,
                posEndBuf = geometry.getAttribute('instanceEnd').array,
                lineWidthBuf = geometry.getAttribute('instanceLineWidth').array,
                disStartBuf = geometry.getAttribute('instanceDisStart').array,
                disEndBuf = geometry.getAttribute('instanceDisEnd').array,
                visibleBuf = geometry.getAttribute('instanceVisible').array,
                flowBuf = geometry.getAttribute('instanceFlowEnable').array,
                colorStartBuf = geometry.getAttribute('instanceLineColorStart').array,
                colorEndBuf = geometry.getAttribute('instanceLineColorEnd').array,
                disOffsetBuf = geometry.getAttribute('instanceLineDisOffset').array,
                pickBuf = geometry.getAttribute('instancePickId').array;
            let cursor = 0, color1, color2;
            // for every link
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const style = link.style || {},
                    geometry = link.geometry, pickId = link._gid;
                let visible, flow = !!style.flow ? 1 : 0;
                if (visibleChange) {
                    if (link.visible === false || link._tempVisible === false) {
                        visible = -1;
                    } else {
                        visible = decideShow instanceof Function
                            ? decideShow({link: link})
                            : 1
                    }
                }
                const {points, distances, totalDis, flowOffset, pointCount} = geometry;
                const lineWidth = style.width || 5;
                if (dataChange || appearChange) {
                    [color1, color2] = getLinkColor(link);
                }
                // for every segment
                for (let j = 0; j <= pointCount - 2; j++) {
                    if (dataChange || visibleChange) {
                        visibleBuf[cursor] = visible;
                    }
                    if (link._inbound && (dataChange || geoChange)) {
                        const s = points[j], t = points[j + 1];
                        posStartBuf[cursor * 3] = s.x;
                        posStartBuf[cursor * 3 + 1] = s.y;

                        posEndBuf[cursor * 3] = t.x;
                        posEndBuf[cursor * 3 + 1] = t.y;

                        disStartBuf[cursor] = (distances[j] / totalDis);
                        disEndBuf[cursor] = (distances[j + 1] / totalDis);
                    }

                    if (dataChange) {
                        disOffsetBuf[cursor] = flowOffset;
                        pickBuf[cursor] = pickId;
                    }
                    if (dataChange || appearChange) {
                        _color.set(color1);
                        colorStartBuf[cursor * 3] = _color.r;
                        colorStartBuf[cursor * 3 + 1] = _color.g;
                        colorStartBuf[cursor * 3 + 2] = _color.b;
                        _color.set(color2);
                        colorEndBuf[cursor * 3] = _color.r;
                        colorEndBuf[cursor * 3 + 1] = _color.g;
                        colorEndBuf[cursor * 3 + 2] = _color.b;
                        lineWidthBuf[cursor] = lineWidth || DefaultLinkWidth;
                        flowBuf[cursor] = flow;
                    }
                    //move cursor
                    cursor += 1;
                }
            }
            if (dataChange || geoChange) {
                [
                    'instanceStart', 'instanceEnd',
                    'instanceDisStart', 'instanceDisEnd',
                ].forEach(key => {
                    geometry.getAttribute(key).needsUpdate = true;
                });
            }
            if (dataChange) {
                geometry.getAttribute('instanceLineDisOffset').needsUpdate = true;
                geometry.getAttribute('instancePickId').needsUpdate = true;
            }
            if (dataChange || appearChange) {
                ['instanceLineColorStart',
                    'instanceLineColorEnd',
                    'instanceFlowEnable'].forEach(key => {
                    geometry.getAttribute(key).needsUpdate = true;
                })
            }
            if (dataChange || visibleChange) {
                geometry.getAttribute('instanceVisible').needsUpdate = true;
            }
        }

        function getLinkColor(link) {
            const {style, source, target} = link;
            let color1 = style?.color || DefaultLinkColor,
                color2 = color1;
            if (style?.gradient) {
                color1 = style?.sColor || source.style?.color || color1;
                color2 = style?.tColor || target.style?.color || color2;
            }
            return [color1, color2]
        }
    }

    _updateBufferData(decideShow) {
        if (!this.hasData || !this.isActive) return;
        if (!this.updateFlag.size) return;
        this._updateNodeBufferData(decideShow);
        this._updateLinkBufferData(decideShow);
        this.updateFlag.clear();
        return this;
    }

    _changePickMode(pick) {
        const {nodesObj, linksObj} = this;
        [nodesObj, linksObj].forEach(obj => {
            obj.material.uniforms.isPick.value = !!pick;
            obj.material.uniforms.showMode.value = ShowMode.normal;
            obj.material.blending = pick ? NoBlending : CustomBlending;
        })
        const zoomScale = this.getRenderSizeScale();
        nodesObj.material.uniforms.scale.value = zoomScale * this.renderCtx.state.dpr;
        linksObj.material.uniforms.resolution.value.set(1, 1);
        linksObj.material.uniforms.lineWidthScale.value = zoomScale * this.renderCtx.state.dpr;
    }

    _getPickObj() {
        if (!this.pickObj) {
            const pickRT = new WebGLRenderTarget(1, 1);
            const pixelBuffer = new Uint8Array(4);
            this.pickObj = {pickRT, pixelBuffer}
        }
        return this.pickObj;
    }

    pick(x, y) {
        if (!this.renderCtx) throw new Error('renderCtx not exist, active this scene first')
        const {camera, renderer, state} = this.renderCtx;
        const {pickRT, pixelBuffer} = this._getPickObj();
        camera.setViewOffset(state.width, state.height, x >> 0, y >> 0, 1, 1);
        renderer.setRenderTarget(pickRT);
        renderer.clear();
        this._changePickMode(true);
        renderer.render(this.scene, camera);
        this._changePickMode(false);
        camera.clearViewOffset();
        renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pixelBuffer);
        let pickId = RGBToId(pixelBuffer);
        if (!pickId) return null;
        const obj = this.graphData.nodes.find(n => n._gid === pickId)
            || this.graphData.links.find(l => l._gid === pickId);
        if (obj?.visible === false || obj?._tempVisible === false) return null;
        return obj;
    }

    requestFrame(reason) {
        if (!this.renderCtx) throw new Error('renderCtx not exist, active this scene first')
        this.renderCtx?.scheduler.requestFrame(reason);
    }

    render({ctx, tags}) {
        if (!this.isActive || !this.hasData || !this._ticks) return;
        this._updateBufferData();

        const {linksObj, nodesObj, grayParams, scene} = this;

        const {renderer, camera, canvas, state} = ctx;
        renderer.autoClear = false;
        renderer.setRenderTarget(null);
        renderer.clear();

        const zoomScale = this.getRenderSizeScale();
        nodesObj.material.uniforms.scale.value = zoomScale * state.dpr;
        linksObj.material.uniforms.resolution.value.set(canvas.width, canvas.height);
        linksObj.material.uniforms.lineWidthScale.value = zoomScale * state.dpr;

        const normalAlpha = 0.2, emphasizeAlpha = 0.6;

        const {enable, scale, _change} = grayParams;
        if (enable && (scale || _change)) {
            const hlLinks = new Set(this.hlSet.get(i => i?.isLink));
            const hlNodes = new Set(this.hlSet.get(i => i?.isNode));
            const hlSize = hlLinks.size + hlNodes.size;
            if (!scale && !hlSize) {
                renderInNormal();
            } else {
                if (hlSize) {
                    this._markFlag(BufferUpdateFlag.nodeVisibleChange);
                    this._markFlag(BufferUpdateFlag.linkVisibleChange);
                    this._updateBufferData(({node, link}) => {
                        if (node) {
                            return hlNodes.has(node) ? 1 : 0;
                        } else {
                            return hlLinks.has(link) ? 1 : 0;
                        }
                    })
                }

                const grayComposer = this.getGrayComposer(ctx);
                checkComposer(grayComposer);
                const {composer, renderPass, grayPass} = grayComposer;
                renderPass.scene = this.scene;
                renderPass.camera = camera;
                grayPass.grayScale = scale;
                grayPass.opacity = 1 - scale * 0.8;
                setLinkAlpha(normalAlpha);
                setShowMode(hlSize ? ShowMode.toggle : ShowMode.normal);
                composer.render();
                if (hlSize) {
                    setLinkAlpha(normalAlpha + (emphasizeAlpha - normalAlpha) * scale);
                    setShowMode(ShowMode.normal);
                    renderer.render(this.scene, camera);
                }
            }

            grayParams._change = false;
        } else {
            renderInNormal();
        }

        function renderInNormal() {
            setLinkAlpha(normalAlpha)
            setShowMode(ShowMode.normal);
            renderer.render(scene, camera);
        }

        function setShowMode(mode) {
            linksObj.material.uniforms.showMode.value =
                nodesObj.material.uniforms.showMode.value = mode;
        }

        function setLinkAlpha(alpha) {
            linksObj.material.uniforms.minAlpha.value = alpha;
        }

        function checkComposer(composer) {
            const state = ctx.state;
            composer.setSize(state.width, state.height);
        }
    }

    highlight(items, tag) {
        const change = this.hlSet.add(items, tag);
        if (change) {
            this._markFlag(BufferUpdateFlag.hlChange);
            this.requestFrame(FrameTrigger.hlChange);
        }
    }

    unHighlight(items, tag) {
        const change = this.hlSet.remove(items, tag);
        if (change) {
            this._markFlag(BufferUpdateFlag.hlChange);
            this.requestFrame(FrameTrigger.hlChange);
        }
    }

    clearHighlight(tag) {
        const change = this.hlSet.clear(tag);
        if (change) {
            this._markFlag(BufferUpdateFlag.hlChange);
            this.requestFrame(FrameTrigger.hlChange);
        }
    }

    enableGrayFilter() {
        if (this.grayParams.enable) return;
        this.grayParams.enable = true;
        if (this.hlSet.get().length) {
            this.requestFrame(FrameTrigger.grayFilterChange);
        }
        return this;
    }

    disableGrayFilter() {
        if (!this.grayParams.enable) return;
        this.requestFrame(FrameTrigger.grayFilterChange);
        this.grayParams.enable = false;
        this.grayParams.scale = 0;
        return this;
    }

    setGrayScale(i) {
        if (i === undefined) throw new Error('grayscale is undefined')
        const cur = MathUtils.clamp(i, 0, 1);
        this.grayParams._change = this.grayParams.scale !== cur;
        this.grayParams.scale = cur;
        if (this.grayParams._change) {
            this.requestFrame(FrameTrigger.grayFilterChange)
        }
    }

    markAppearChange(node, link) {
        node && this._markFlag(BufferUpdateFlag.nodeAppearChange);
        link && this._markFlag(BufferUpdateFlag.linkAppearChange);
        node && link && this.requestFrame(FrameTrigger.appearChange);
    }

    dispose() {
        this.dispatchEvent({type: 'dispose'});
        this.deactive();
        this.grayScaleComposer?.dispose();
    }
}
