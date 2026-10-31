const app = window.comfyAPI?.app?.app;

function writePreviousWidgetValues(node) {
    if (!node.widgets) return false;
    node.widgets.forEach((widget, index) => {
        widget._paramHighlighter = widget._paramHighlighter || {
            previousValue: undefined,
            hasChanged: false
        };
        widget._paramHighlighter.previousValue = widget.value;
        widget._paramHighlighter.hasChanged = widget.value !== widget._paramHighlighter.previousValue;
    });
    return true;
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

                    node.setDirtyCanvas(true, true);

                    originalCallback?.apply(this, arguments);
                };

                widget._parentNode = this;
            });
        };
    },

    async setup() {
        const originalQueuePrompt = app.queuePrompt;

        // set new previousValues and remove highlight when user runs the workflow
        app.queuePrompt = async function (number, batch_count) {
            const paramHighlighter = window._paramHighlighter;

            if (app.graph && app.graph._nodes) {
                app.graph._nodes.forEach(node => {
                    if (node.widgets) {
                        writePreviousWidgetValues(node);
                        node.widgets.forEach((widget) => {
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
                if (widget._paramHighlighter.hasChanged && widget.last_y !== undefined) {

                    const x = margin;
                    const y = widget.last_y;
                    const w = node.size[0] - margin * 2;
                    const h = LiteGraph.NODE_WIDGET_HEIGHT;

                    ctx.save();
                    ctx.lineWidth = 1;

                    const lowQualityZoom = this.ds.scale < app.canvas._lowQualityZoomThreshold
                    const color = widget._paramHighlighter.hasChanged ? "#ffa931" : null;

                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(x, y, w, h, lowQualityZoom ? 0 : h);
                    } else {
                        ctx.rect(x, y, w, h);
                    }

                    if (lowQualityZoom) {
                        ctx.fillStyle = color;
                        ctx.fill();
                    } else {
                        ctx.strokeStyle = color;
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            });
        };
    }
});
