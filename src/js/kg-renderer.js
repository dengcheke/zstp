import {EventDispatcher, OrthographicCamera, Vector2, Vector3, WebGLRenderer} from "three";
import {FrameFirer} from './utils';
import {CustomTrackballControls} from "./custom-trackball-controls";

const _vec3 = new Vector3();

const DEFAULT_CONSTRAINT = Object.freeze({
    minZoom: 0.001,
    maxZoom: Infinity,
    frustumSize: 1,
});

export const FrameTrigger = Object.freeze({
    control: 'control', //可视化范围改变, 平移缩放等
    resize: 'resize',
    simulateTick: 'simulateTick', //模拟过程
    hlChange: 'hlChange',
    appearChange: 'appearChange',
    flowLinkAnimation: 'flowLinkAnimation',
    grayFilterChange: 'grayFilterChange',
});

const KgMapEvent = Object.freeze({
    beforeRender: 'beforeRender',
    afterRender: 'afterRender',
});

export class KgRenderer extends EventDispatcher {
    constructor(canvas = document.createElement('canvas')) {
        super();
        this._initialized = false; //是否初始化
        this._schded = false; //是否安排了一帧
        this._needAskNextFrame = false;
        this._isRendering = false;
        this.frameTags = new Set(); //帧标记
        //帧状态
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
        //约束
        this.constraint = {...DEFAULT_CONSTRAINT};
        this.curScene = null;
        this.init(canvas);
    }

    init(canvas) {
        if (this._initialized) return;
        const renderer = new WebGLRenderer({canvas, alpha: true});
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
            this.requestFrame(FrameTrigger.control);
        });
        let _stableTimer = 0;
        const smoothTransition = new FrameFirer(() => {
            this.requestFrame(FrameTrigger.control);
        });
        control.addEventListener('start', () => {
            this.state.stable = false;
            clearTimeout(_stableTimer);
            smoothTransition.start();
        });
        control.addEventListener('end', () => {
            clearTimeout(_stableTimer);
            _stableTimer = setTimeout(() => {
                this.state.stable = true;
                smoothTransition.stop();
            }, 300)
        });

        this.addEventListener(KgMapEvent.beforeRender, () => {
            control.update();
            this.state.curExtent = this.control.curExtent;
            //1 pixel = x world unit
            this.state.resolution = (camera.top - camera.bottom) / this.state.height;
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
            this.requestFrame(FrameTrigger.resize);
        }
        this.dispatchEvent({type: 'resize', state});
        return this;
    }

    setConstraint(constraint) {
        this.constraint = constraint || {...DEFAULT_CONSTRAINT};
        this._updateWithConstraint();
    }

    _updateWithConstraint() {
        updateOrthographicCamera({
            camera: this.camera,
            frustumSize: this.constraint.frustumSize,
            aspect: this.state.aspect
        })
        this.control.applyOrthographicConstrain2D(this.constraint, this.state.aspect);
        this.state.fullExtent = this.control.fullExtent;

        function updateOrthographicCamera({camera, frustumSize, aspect}) {
            camera.left = -frustumSize * aspect;
            camera.right = frustumSize * aspect;
            camera.top = frustumSize;
            camera.bottom = -frustumSize;
            camera.updateProjectionMatrix();
        }
    }

    use(scene) {
        this.curScene?.onRemove?.();
        this.curScene = scene;
        this.curScene?.onAdd?.(this);
        this.requestFrame('layer add');
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

    pick(x, y) {
        if (!this.curScene) return null;
        return this.curScene.pick(x, y);
    }

    requestFrame(reason) {
        if (this._isRendering) {
            this._needAskNextFrame = true;
            reason && this.frameTags.add(reason)
            return;
        } else {
            reason && this.frameTags.add(reason);
            if (this._schded) return;
            this._schded = true;
        }
        requestAnimationFrame(() => {
            if (!this.curScene) return;
            const tags = this.frameTags;
            const _tags = new Set(Array.from(tags));
            tags.clear();

            this._isRendering = true;
            this.dispatchEvent({type: KgMapEvent.beforeRender, _tags});
            this.renderer.setRenderTarget(null);
            this.renderer.clear();

            const params = {ctx: this, tags: _tags};

            try {
                this.curScene.beforeRender?.(params);
                this.curScene.render(params);
                this.curScene.afterRender?.(params);
            } finally {
                this._schded = false;
                this._isRendering = false;
                tags.clear();
                this.dispatchEvent({type: KgMapEvent.afterRender, _tags});
            }
            if (this._needAskNextFrame) {
                this._needAskNextFrame = false;
                this.requestFrame('ask next frame');
            }
        })
    }
}
