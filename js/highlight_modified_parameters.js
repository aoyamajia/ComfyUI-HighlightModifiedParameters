const app = window.comfyAPI?.app?.app;

const DECAY = 0.25;
const PREVCHANGED = "#ffa931";
const WIDGETCOLOR = [102, 102, 102];
const LOWQUALITYWIDGETCOLOR = [34, 34, 34];

function writePreviousWidgetValues(node) {
    if (!node.widgets) return false;
    node.widgets.forEach((widget, index) => {
        widget._paramHighlighter = widget._paramHighlighter || {
            previousValue: undefined,
            hasChanged: false,
            heat: 0
        };
        widget._paramHighlighter.previousValue = widget.value;
        widget._paramHighlighter.hasChanged = widget.value !== widget._paramHighlighter.previousValue;
    });
    return true;
}

function calculateColor(heat, base) {
    if (heat === 1) return "#fff";
    if (heat <= 0) return null;
    const keyframes = [
        { p: 0.00, rgb: base },
        { p: 0.33, rgb: [119,  51,  51] }, // #733    - dark red
        { p: 0.66, rgb: [255, 169,  49] }, // #ffa931 - orange
        { p: 1.00, rgb: [255, 255, 255] }  // #fff    - white
    ];

    let lower = keyframes[0];
    let upper = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
        if (heat >= keyframes[i].p && heat <= keyframes[i+1].p) {
            lower = keyframes[i];
            upper = keyframes[i+1];
            break;
        }
    }

    const range = upper.p - lower.p;
    const factor = range === 0 ? 0 : (heat - lower.p) / range;

    const r = Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * factor);
    const g = Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * factor);
    const b = Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * factor);

    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

app.registerExtension({
    name: "HighlightModifiedParameters",

    async init() {
        window._paramHighlighter = window._paramHighlighter || {
            parameterValues: {},
            isGraphReady: false
        };
    },

    // handle default parameter values for added nodes
    async nodeCreated(node) {
        const paramHighlighter = window._paramHighlighter;
        // wait until afterConfigureGraph was called
        if (!paramHighlighter.isGraphReady) return;

        writePreviousWidgetValues(node);
    },

    // if loading a workflow, read parameters after loading
    async afterConfigureGraph() {
        const paramHighlighter = window._paramHighlighter;

        if (!app.graph || !app.graph._nodes) return;
        app.graph._nodes.forEach(node => {
            writePreviousWidgetValues(node);
        });

        paramHighlighter.isGraphReady = true;
    },

    // widget callback: track when a value was changed
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            originalOnNodeCreated?.apply(this, arguments);

            if (!this.widgets) return;
            this.widgets.forEach((widget, index) => {
                const originalCallback = widget.callback;

                widget.callback = function (value) {
                    const paramHighlighter = window._paramHighlighter;
                    if (!paramHighlighter.isGraphReady) return;

                    const node = this._parentNode || widget._parentNode;
                    if (!node) return;

                    const previousValue = this._paramHighlighter.previousValue;
                    this._paramHighlighter.hasChanged = value !== previousValue;
                    this._paramHighlighter.heat = this._paramHighlighter.hasChanged ? 1 : 0;

                    node.setDirtyCanvas(true, true);

                    originalCallback?.apply(this, arguments);
                };

                widget._parentNode = this;
            });
        };
    },

    async setup() {
        console.log(LiteGraph);
        const originalQueuePrompt = app.queuePrompt;

        // set new previousValues and remove highlight when user runs the workflow
        app.queuePrompt = async function (number, batch_count) {
            const paramHighlighter = window._paramHighlighter;

            if (app.graph && app.graph._nodes) {
                app.graph._nodes.forEach(node => {
                    if (node.widgets) {
                        writePreviousWidgetValues(node);
                        node.widgets.forEach((widget) => {
                            if (!widget._paramHighlighter.hasChanged && widget._paramHighlighter.heat > 0) {
                                widget._paramHighlighter.heat -= DECAY;
                            } else {
                                widget._paramHighlighter.heat = 0;
                            }
                            widget._paramHighlighter.hasChanged = false;
                        });
                    }
                });
            }

            if (app.canvas) app.canvas.setDirty(true, true);
            return originalQueuePrompt.apply(this, arguments);
        };

        // hijack drawNodeWidgets to draw an outline on top of the actual widget outline
        const originalDrawNodeWidgets = LGraphCanvas.prototype.drawNodeWidgets;
        LGraphCanvas.prototype.drawNodeWidgets = function (node, _, ctx) {
            // call original drawNodeWidgets first
            originalDrawNodeWidgets?.apply(this, arguments);

            if (!ctx || !node?.widgets) return;
            const margin = 15;
            node.widgets.forEach((widget) => {
                if (!widget._paramHighlighter) return;
                if (widget._paramHighlighter.heat && widget.last_y !== undefined) {

                    const x = margin;
                    const y = widget.last_y;
                    const w = node.size[0] - margin * 2;
                    const h = LiteGraph.NODE_WIDGET_HEIGHT;

                    ctx.save();
                    ctx.lineWidth = 1;

                    const lowQualityZoom = this.ds.scale < app.canvas._lowQualityZoomThreshold
                    const color = calculateColor(widget._paramHighlighter.heat, lowQualityZoom ? LOWQUALITYWIDGETCOLOR : WIDGETCOLOR);

                    if (color != null) {
                        ctx.beginPath();
                        if (ctx.roundRect) {
                            ctx.roundRect(x, y, w, h, lowQualityZoom ? 0 : h);
                        } else {
                            ctx.rect(x, y, w, h);
                        }

                        if (lowQualityZoom) {
                            ctx.globalAlpha = 0.5;
                            ctx.fillStyle = color;
                            ctx.fill();
                        } else {
                            ctx.strokeStyle = color;
                            ctx.stroke();
                        }
                    }
                    ctx.restore();
                }
            });
        };
    }
});
