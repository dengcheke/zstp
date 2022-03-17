import {MathUtils, Vector2} from "three";

const _vec2 = new Vector2();
export const ForceBoundType = Object.freeze({
    box: 'box',
    radial: 'radial'
})

export function forceBound(bounding) {
    let nodes, bound = bounding, strength = 0.1;

    function fix(source, target, alpha) {
        source = source || 1e-6;
        return (target - source) * strength * alpha;
    }

    function constraintNode(node, alpha) {
        if (!bound) return;
        if (bound.type === ForceBoundType.box) {
            const {xmin, xmax, ymin, ymax} = bound;
            const _x = MathUtils.clamp(node.x, xmin, xmax);
            if (node.x !== _x) {
                node.vx += fix(node.x, _x, alpha);
            }
            const _y = MathUtils.clamp(node.y, ymin, ymax);
            if (node.y !== _y) {
                node.vy += fix(node.y, _y, alpha);
            }

        } else if (bound.type === ForceBoundType.radial) {
            const r = bound.radius || 1;
            const center = bound.center || [0, 0];
            //dx,dy
            _vec2.set(
                (node.x - center[0]) || 1e-6,
                (node.y - center[1]) || 1e-6
            );
            const len = _vec2.length(); //r
            if (len > r) {
                const k = (r - len) * strength * alpha / len;
                node.vx += _vec2.x * k;
                node.vy += _vec2.y * k;
            }
        } else if (bound instanceof Function) {
            bound(node);
        }
    }

    function force(alpha) {
        nodes.forEach(n => constraintNode(n, alpha))
    }

    force.initialize = function (_) {
        nodes = _;
    };
    force.bound = function (_) {
        if (!arguments.length) return bound;
        bound = _;
        return force;
    }
    force.strength = function (_){
        if (!arguments.length) return strength;
        strength = _ || 0.1;
        return force;
    }
    return force;
}
