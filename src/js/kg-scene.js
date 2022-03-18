import {
    Box2,
    BufferGeometry,
    Color,
    CustomBlending,
    DynamicDrawUsage,
    EventDispatcher,
    Float32BufferAttribute,
    InstancedBufferAttribute,
    MathUtils,
    NoBlending,
    OneMinusSrcAlphaFactor,
    Points,
    QuadraticBezierCurve,
    Scene,
    ShaderMaterial,
    SrcAlphaFactor,
    StaticDrawUsage,
    Vector2,
    WebGLRenderTarget
} from "three";
import {compute2DCurveDisFromStart, RGBToId, TagSet} from "./utils";
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer'
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry'
import {forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY} from "d3-force";
import {forceBound, ForceBoundType} from "./force-bound";
import {linkFragShader, linkVertexShader} from "./gl/Link.glsl";
import {GrayFilterPass} from "./gl/GrayFilterPass";
import {NodeFragShader, NodeVertexShader} from "./gl/Node.glsl";
import {isObject} from "lodash-es";
import {FrameTrigger} from "./kg-renderer";

const _color = new Color();
const _vec2 = new Vector2();
const _box2 = new Box2();
const _2dBzrCurve = new QuadraticBezierCurve();

const DefaultNodeSize = 40;
const DefaultNodeColor = 'white';
const DefaultLinkColor = 'red';
const DefaultLinkWidth = 4;

const BufferUpdateFlag = Object.freeze({
    dataChange: 100,//数据改变
    geometryChange: 200,//几何位置改变
    nodeAppearChange: 300, //node 外观变化, 颜色大小,
    linkAppearChange: 350, //link 颜色变化, 宽度等,
    nodeVisibleChange: 1000, //node 是否可见
    linkVisibleChange: 1001, //link 是否可见,
})
const ShowMode = Object.freeze({
    //0(关闭, vshow 不生效, 都显示); //用于pick
    none: 0,
    //1(正常模式, vshow=1 显示);
    normal: 1,
    // 2(toggle, vshow=0 显示);
    toggle: 2
})
const RenderOrder = Object.freeze({
    Polyline: 1,
    Point: 2
})

//存储曲线的 归一化距离,
//相同的cFactor, 归一化距离基本一致,
const _2dBzrNormalDisCache = {
    0: [0, 1],//直线
};

const _BzrCurvePointCount = 25; //25个点, 24个线段
const _BzrCurvePointIndex = new Array(_BzrCurvePointCount)
    .fill(0).map((i, idx) => idx / (_BzrCurvePointCount - 1));
const _StraightLinePointIndex = [0, 1];

export class KgScene extends EventDispatcher {
    constructor(name) {
        super();
        this._ticks = 0; //模拟ticks
        this._gid = 1;

        this.name = name;
        this.hasData = false;
        this.isActive = false;
        this.updateFlag = new Set();

        this.grayParams = {
            enable: false,
            scale: 0,
        }

        this.hlSet = new TagSet('highlight');//高亮

        this.constraint = {
            minZoom: 0.2,
            maxZoom: 6,
            frustumSize: 1500,
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
                this.requestFrame('simulateTick');
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
                        //直线
                        if (link.geometry.pointCount === 2) {
                            link._inbound = false;
                            link._tempVisible = false;
                            return;
                        }
                        //曲线
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
                    const {source, target, geometry} = link;

                    let distances;
                    const cacheKey = geometry.cFactor;
                    if (_2dBzrNormalDisCache[cacheKey]) {
                        distances = _2dBzrNormalDisCache[cacheKey];
                    } else {
                        const curve = _2dBzrCurve;
                        curve.v0.set(source.x, source.y);
                        curve.v1.copy(geometry.controlPoint);
                        curve.v2.set(target.x, target.y);
                        const _points = curve.getPoints(geometry.pointCount - 1);
                        distances = compute2DCurveDisFromStart(_points, true);
                        _2dBzrNormalDisCache[geometry.cFactor] = distances;
                    }
                    //compute bzr point in gpu, we only set t here,
                    const pointT = geometry.pointCount === 2
                        ? _StraightLinePointIndex
                        : _BzrCurvePointIndex

                    Object.assign(link.geometry, {
                        pointT,//曲线每个点对应贝塞尔参数 t
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
        scene.add(nodesObj, linksObj);
        this.addEventListener('dispose', () => {
            [nodesObj, linksObj].map(({geometry, material}) => {
                geometry.dispose();
                material.dispose();
            })
        });
        Object.assign(this, {
            scene, nodesObj, linksObj
        });
    }

    getRenderSizeScale() {
        if (!this.renderCtx) return 1;
        const {camera} = this.renderCtx;
        return MathUtils.clamp(camera.zoom, 0.5, 1)
    }

    getGrayComposer() {
        if (!this.grayComposer) {
            const composer = new EffectComposer(this.renderCtx.renderer);
            const renderPass = new RenderPass();
            const grayPass = new GrayFilterPass();
            grayPass.renderToScreen = true;
            composer.addPass(renderPass);
            composer.addPass(grayPass);
            this.grayComposer = {
                composer,
                renderPass,
                grayPass
            }
        }
        return this.grayComposer;
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
                        geo.pointCount = _BzrCurvePointCount;
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
            }
            return simulateLinks;
        }

        function getGeometry(link) {
            if (link.geometry === undefined) link.geometry = {};
            return link.geometry;
        }
    }

    beforeRender(args) {
        this.dispatchEvent({
            type: 'before-render',
            ...args
        })
    }

    afterRender(args) {
        this.dispatchEvent({
            type: 'after-render',
            ...args
        })
    }

    onAdd(renderCtx) {
        if (!renderCtx) return;
        this.renderCtx = renderCtx;
        this.getGrayComposer();
        this.hasData && this.simulate.restart();
        this.isActive = true;
        this.requestFrame = (reason) => {
            this.renderCtx.requestFrame(reason);
        }
    }

    onRemove() {
        this.renderCtx = null;
        this.simulate.stop();
        this.isActive = false;
        this.requestFrame = null;
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
                {name: 'isHl', usage: DynamicDrawUsage, itemSize: 1},
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
            const hlSet = new Set(this.hlSet.get());
            const posBuf = geometry.getAttribute('position').array,
                colorBuf = geometry.getAttribute('color').array,
                sizeBuf = geometry.getAttribute('size').array,
                pickIdBuf = geometry.getAttribute('pickId').array,
                visibleBuf = geometry.getAttribute('visible').array,
                hlBuf = geometry.getAttribute('isHl').array;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i], i3 = i * 3;
                if (dataChange || visibleChange || appearChange) {
                    let visible;
                    if (node.visible === false) {
                        visible = -1;
                    } else {
                        visible = decideShow instanceof Function
                            ? decideShow({node: node})
                            : 1 //默认可见
                    }
                    visibleBuf[i] = visible;

                    hlBuf[i] = hlSet.has(node) ? 1 : 0;

                    const style = node.style || {};
                    sizeBuf[i] = (style.size || DefaultNodeSize)
                        + (visible >= 1 && hlBuf[i] ? 2.5 : 0);

                    _color.set(style.color || DefaultNodeColor);
                    colorBuf[i3] = _color.r;
                    colorBuf[i3 + 1] = _color.g;
                    colorBuf[i3 + 2] = _color.b;
                }
                if (dataChange || geoChange) {
                    posBuf[i3] = node.x;
                    posBuf[i3 + 1] = node.y;
                }
                if (dataChange) {
                    pickIdBuf[i] = node._gid;
                }
            }

            if (geoChange || dataChange) {
                geometry.getAttribute('position').needsUpdate = true;
            }
            if (appearChange || dataChange || visibleChange) {
                geometry.getAttribute('color').needsUpdate = true;
                geometry.getAttribute('size').needsUpdate = true;
                geometry.getAttribute('visible').needsUpdate = true;
                geometry.getAttribute('isHl').needsUpdate = true;
            }
            if (dataChange) {
                geometry.getAttribute('pickId').needsUpdate = true;
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
                    {name: "instance_Bzr_T", itemSize: 4, usage: DynamicDrawUsage}, //[before, source, target, after]t
                    {name: "instance_C1_Dis", itemSize: 4, usage: DynamicDrawUsage},//控制点1, 归一化距离s, 归一化距离y,
                    {name: "instance_C2_C3", itemSize: 4, usage: DynamicDrawUsage}, //控制点2 3

                    {name: "instanceVisible", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceLineWidth", itemSize: 1, usage: DynamicDrawUsage},
                    {name: "instanceFlowEnable", itemSize: 1, usage: DynamicDrawUsage},
                    //static
                    {name: "instanceLineColorStart", itemSize: 3, usage: StaticDrawUsage},
                    {name: "instanceLineColorEnd", itemSize: 3, usage: StaticDrawUsage},
                    {name: "instance_PickId_Offset", itemSize: 2, usage: StaticDrawUsage},
                ].forEach(({name, itemSize, usage}) => {
                    const attr = new InstancedBufferAttribute(new Float32Array(segmentCount * itemSize), itemSize);
                    attr.setUsage(usage).name = name;
                    geometry.setAttribute(name, attr);
                })
            }

            //update buffer data
            const geometry = linksObj.geometry;
            const tBuf = geometry.getAttribute('instance_Bzr_T').array,
                c1_dis_buf = geometry.getAttribute('instance_C1_Dis').array,
                c2_c3_Buf = geometry.getAttribute('instance_C2_C3').array,
                lineWidthBuf = geometry.getAttribute('instanceLineWidth').array,
                visibleBuf = geometry.getAttribute('instanceVisible').array,
                flowBuf = geometry.getAttribute('instanceFlowEnable').array,
                colorStartBuf = geometry.getAttribute('instanceLineColorStart').array,
                colorEndBuf = geometry.getAttribute('instanceLineColorEnd').array,
                pick_Offset_Buf = geometry.getAttribute('instance_PickId_Offset').array;
            let cursor = 0, color1, color2;
            // for every link
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const style = link.style || {},
                    geometry = link.geometry,
                    pickId = link._gid,
                    {source, target} = link;
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
                const {pointT, distances, flowOffset, pointCount, controlPoint} = geometry;
                const lineWidth = style.width || 5;
                if (dataChange || appearChange) {
                    [color1, color2] = getLinkColor(link);
                }
                // for every segment
                for (let j = 0, limit = pointCount - 2; j <= limit; j++) {
                    const c2 = cursor * 2, c3 = cursor * 3, c4 = cursor * 4;
                    if (dataChange || visibleChange) {
                        visibleBuf[cursor] = visible;
                        if (visible === -1) continue;
                    }
                    if (link._inbound && (dataChange || geoChange)) {
                        const c4_1 = c4 + 1, c4_2 = c4 + 2, c4_3 = c4 + 3;

                        tBuf[c4] = j === 0 ? pointT[0] : pointT[j - 1];
                        tBuf[c4_1] = pointT[j];
                        tBuf[c4_2] = pointT[j + 1];
                        tBuf[c4_3] = j === limit ? pointT[j + 1] : pointT[j + 2];

                        c1_dis_buf[c4] = source.x;
                        c1_dis_buf[c4_1] = source.y;
                        c1_dis_buf[c4_2] = distances[j];
                        c1_dis_buf[c4_3] = distances[j + 1];

                        c2_c3_Buf[c4] = controlPoint.x;
                        c2_c3_Buf[c4_1] = controlPoint.y;
                        c2_c3_Buf[c4_2] = target.x;
                        c2_c3_Buf[c4_3] = target.y;
                    }

                    if (dataChange) {
                        pick_Offset_Buf[c2] = pickId;
                        pick_Offset_Buf[c2 + 1] = flowOffset;
                    }

                    if (dataChange || appearChange) {
                        const c3_1 = c3 + 1, c3_2 = c3 + 2;
                        _color.set(color1);
                        colorStartBuf[c3] = _color.r;
                        colorStartBuf[c3_1] = _color.g;
                        colorStartBuf[c3_2] = _color.b;
                        _color.set(color2);
                        colorEndBuf[c3] = _color.r;
                        colorEndBuf[c3_1] = _color.g;
                        colorEndBuf[c3_2] = _color.b;
                        lineWidthBuf[cursor] = lineWidth || DefaultLinkWidth;
                        flowBuf[cursor] = flow;
                    }
                    //move cursor
                    cursor += 1;
                }
            }
            if (dataChange) {
                geometry.getAttribute('instance_PickId_Offset').needsUpdate = true;
            }
            if (dataChange || geoChange) {
                [
                    'instance_Bzr_T',
                    'instance_C2_C3',
                    'instance_C1_Dis',
                ].forEach(key => {
                    geometry.getAttribute(key).needsUpdate = true;
                });
            }
            if (dataChange || appearChange) {
                [
                    'instanceLineColorStart',
                    'instanceLineColorEnd',
                    'instanceFlowEnable'
                ].forEach(key => {
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
        return true;
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

    render({ctx, tags}) {
        if (!this.isActive || !this.hasData || !this._ticks) return;//_ticks=0 代表没开始模拟
        const update = this._updateBufferData();

        const {linksObj, nodesObj, grayParams, scene} = this, self = this;

        const {renderer, camera, canvas, state} = ctx;
        renderer.autoClear = false;
        this._changePickMode(false);
        const zoomScale = this.getRenderSizeScale();
        nodesObj.material.uniforms.scale.value = zoomScale * state.dpr;
        linksObj.material.uniforms.resolution.value.set(canvas.width, canvas.height);
        linksObj.material.uniforms.lineWidthScale.value = zoomScale * state.dpr;
        linksObj.material.uniforms.time.value = performance.now() / 1000;

        const hlLinks = new Set(this.hlSet.get(i => i?.isLink));
        const hlNodes = new Set(this.hlSet.get(i => i?.isNode));
        const hlSize = hlLinks.size + hlNodes.size;

        const normalAlpha = 0.3, emphasizeAlpha = 0.6;
        const {enable, scale} = grayParams;

        if (!hlSize) {
            setShowMode(ShowMode.normal);
            setLinkAlpha(normalAlpha);
            if (enable && scale) {
                renderGray();
            } else {
                renderer.render(scene, camera);
            }
        } else {
            //高亮强调的后渲染, zIndex 在上

            //pass 1, 渲染非高亮
            //1.1 更新可见性, 高亮为1,
            {
                if (tags.has(FrameTrigger.hlChange) || update) {
                    //如果update=true, 会重置buffer到基础状态, 这里需要重新更改
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
            }
            //1.2 对非高亮部分执行 grayFilter
            {
                //先画非高亮
                setShowMode(ShowMode.toggle);
                if (enable && scale) {
                    setLinkAlpha(normalAlpha);
                    renderGray();
                } else {
                    setLinkAlpha(normalAlpha);
                    renderer.render(scene, camera);
                }
            }
            //1.3 画高亮部分
            {
                setLinkAlpha(normalAlpha + (emphasizeAlpha - normalAlpha) * scale);
                setShowMode(ShowMode.normal);
                renderer.render(this.scene, camera);
            }
        }

        const flow = this.graphData?.links.find(link => link.style?.flow);
        flow && this.requestFrame('flow link');

        function renderGray() {
            const grayComposer = self.getGrayComposer();
            const {composer, renderPass, grayPass} = grayComposer;
            const state = ctx.state;
            if (composer._width !== state.width || composer._height !== state.height) {
                composer.setSize(state.width, state.height);
            }
            renderPass.scene = self.scene;
            renderPass.camera = camera;
            grayPass.grayScale = scale;
            grayPass.opacity = 1 - scale * 0.8;
            composer.render();
        }

        function setShowMode(mode) {
            linksObj.material.uniforms.showMode.value =
                nodesObj.material.uniforms.showMode.value = mode;
        }

        function setLinkAlpha(alpha) {
            linksObj.material.uniforms.minAlpha.value = alpha;
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
        this.grayParams.scale = MathUtils.clamp(i, 0, 1);
        this.requestFrame(FrameTrigger.grayFilterChange);
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
