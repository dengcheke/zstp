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
export function nodeDragHelper(el, {onPosChange, init, onLeave}) {
    const state = init instanceof Function ? (init() || {}) : {};
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
