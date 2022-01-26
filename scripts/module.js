const ModuleName = "curved-text"
Hooks.once('init', async function () {
    libWrapper.register('curved-text', 'Drawing.prototype._createText', newText, 'OVERRIDE')
    libWrapper.register('curved-text', 'Drawing.prototype.refresh', refresh, 'OVERRIDE')
    game.settings.register(ModuleName, "presets", {
        scope: "world",
        config: false,
        default: [],
        type: Object,
    })
    libWrapper.register(ModuleName, 'Drawing.prototype._onUpdate', function (wrapped, ...args) {
        const data = args[0];

        // if flags were touched, touch 'type' to force a redraw
        if (data.flags && data.flags[ModuleName])
            data['type'] = data['type'] ?? this.data.type;

        return wrapped.apply(this, args);
    }, 'WRAPPER');
    applyConfig()
});

Hooks.on("updateDrawing", async (doc, update, options, id) => {
    if (doc.object.text.style.wordWrap) await doc.object.draw()
})
Hooks.on('getSceneControlButtons', getSceneControlButtons)


Hooks.on('renderDrawingConfig', (data, html, options) => {

    let currentPreset = data.object.data.flags[ModuleName]?.preset
    let content = `
    <div class="form-group">
                    <label>Is Curved Text</label>
                    <input id="curved" name="flags.${ModuleName}.curved" type="checkbox" ${data.object.data.flags[ModuleName]?.curved ? 'checked' : ''}></input>
                </div>
                <div class="form-group">
                <label>Curve Arc</label>
                <input id="arc" name="flags.${ModuleName}.arc" type="Number" value="${data.object.data.flags[ModuleName]?.arc}"></input>
            </div>
    `
    let presets = `<option selected value="none"> None</option>`
    for (const [index, element] of CONFIG.textPresets.entries()) {
        presets += `<option value="${element.name}" ${currentPreset === element.name ? "selected" : ""}>${element.name}</option>`;
    }
    let presetSelector = `
    <div class="form-group">
                    <label>Text Preset</label>
                    <select id="preset" name="flags.${ModuleName}.preset">
                    ${presets}
                    </select>
                </div>
    `
    let lastInput = html.find("input[name='textAlpha']").closest(".form-group")
    let firstInput = html.find("input[name='text']").closest(".form-group")
    lastInput.after(content)
    firstInput.before(presetSelector)
});

function applyConfig() {
    let presets = game.settings.get(ModuleName, "presets")
    CONFIG.textPresets = presets
}

async function updateDrawings() {
    for (let i of canvas.drawings.placeables) {
        await i.draw()
    }
}

function newText() {
    if (this.text && !this.text._destroyed) {
        this.text.destroy();
        this.text = null;
    }
    const isText = this.data.type === CONST.DRAWING_TYPES.TEXT;
    const stroke = Math.max(Math.round(this.data.fontSize / 32), 2);

    let style = {
        fontFamily: this.data.fontFamily || CONFIG.defaultFontFamily,
        fontSize: this.data.fontSize,
        fill: this.data.textColor || "#FFFFFF",
        stroke: "#111111",
        strokeThickness: stroke,
        dropShadow: true,
        dropdropShadowColor: "#000000",
        dropdropShadowBlur: Math.max(Math.round(this.data.fontSize / 16), 2),
        dropdropShadowAngle: 0,
        dropShadowDistance: 0,
        align: isText ? "left" : "center",
        wordWrap: !isText,
        wordWrapWidth: 1.5 * this.data.width,
        padding: stroke
    }
    const styleName = this.data.flags[ModuleName]?.preset
    const styleIndex = CONFIG.textPresets.findIndex(i => i.name === styleName)
    if (styleIndex > -1) {
        let preset = CONFIG.textPresets[styleIndex]
        style = preset.style
        if (preset.autoWrap) {
            style.wordWrapWidth = this.data.width
        }
    }

    // Define the text style
    const textStyle = new PIXI.TextStyle(style);

    // Create the text container
    let text = new PreciseText(this.data.text, textStyle);
    if (!this.data.flags[ModuleName]?.curved || !this.data.flags[ModuleName]?.arc) return text
    const tL = text.width
    const arc = this.data.flags[ModuleName].arc
    const arcFraction = 180 / arc
    const radius = (tL / Math.PI) * arcFraction
    const maxRopePoints = 100;
    const step = Math.PI / maxRopePoints;

    let ropePoints = maxRopePoints - Math.round((text.width / (radius * Math.PI)) * maxRopePoints);
    ropePoints /= 2;

    let points = [];
    for (let i = maxRopePoints - ropePoints; i > ropePoints; i--) {
        const x = radius * Math.cos(step * i);
        const y = radius * Math.sin(step * i);
        points.push(new PIXI.Point(-x, y));
    }
    const name = new PIXI.SimpleRope(text.texture, points);
    name.isCurved = true
    name.curvedData = { radius: radius, arc: arc, arcFraction: arcFraction }
    return name;
}

function refresh() {
    if (this._destroyed || this.shape._destroyed) return;
    const isTextPreview = (this.data.type === CONST.DRAWING_TYPES.TEXT) && this._controlled;
    this.shape.clear();

    // Outer Stroke
    if (this.data.strokeWidth || isTextPreview) {
        let sc = foundry.utils.colorStringToHex(this.data.strokeColor || "#FFFFFF");
        const sw = isTextPreview ? 8 : this.data.strokeWidth ?? 8;
        this.shape.lineStyle(sw, sc, this.data.strokeAlpha ?? 1);
    }

    // Fill Color or Texture
    if (this.data.fillType || isTextPreview) {
        const fc = foundry.utils.colorStringToHex(this.data.fillColor || "#FFFFFF");
        if ((this.data.fillType === CONST.DRAWING_FILL_TYPES.PATTERN) && this.texture) {
            this.shape.beginTextureFill({
                texture: this.texture,
                color: fc || 0xFFFFFF,
                alpha: fc ? this.data.fillAlpha : 1
            });
        } else {
            const fa = isTextPreview ? 0.25 : this.data.fillAlpha;
            this.shape.beginFill(fc, fa);
        }
    }

    // Draw the shape
    switch (this.data.type) {
        case CONST.DRAWING_TYPES.RECTANGLE:
        case CONST.DRAWING_TYPES.TEXT:
            this._drawRectangle();
            break;
        case CONST.DRAWING_TYPES.ELLIPSE:
            this._drawEllipse();
            break;
        case CONST.DRAWING_TYPES.POLYGON:
            this._drawPolygon();
            break;
        case CONST.DRAWING_TYPES.FREEHAND:
            this._drawFreehand();
            break;
    }

    // Conclude fills
    this.shape.lineStyle(0x000000, 0.0).closePath();
    this.shape.endFill();

    // Set shape rotation, pivoting about the non-rotated center
    this.shape.pivot.set(this.data.width / 2, this.data.height / 2);
    this.shape.position.set(this.data.width / 2, this.data.height / 2);
    this.shape.rotation = Math.toRadians(this.data.rotation || 0);

    // Update text position and visibility

    if (this.text && this.text.isCurved) {
        this.text.alpha = this.data.textAlpha ?? 1.0;
        //this.text.position.set(this.data.width / 2, this.data.height + this.text.height / 2)
        this.text.position.set(
            this.data.width / 2,
            this.data.height / 2 + this.text.curvedData.radius - this.text.height / 2
        );
        this.text.rotation = this.shape.rotation + Math.PI;
    }
    else if (this.text) {
        this.text.alpha = this.data.textAlpha ?? 1.0;
        this.text.pivot.set(this.text.width / 2, this.text.height / 2);
        this.text.position.set(
            (this.text.width / 2) + ((this.data.width - this.text.width) / 2),
            (this.text.height / 2) + ((this.data.height - this.text.height) / 2)
        );
        this.text.rotation = this.text.isCurved ? this.shape.rotation + Math.PI : this.shape.rotation;
    }

    // Determine shape bounds and update the frame
    const bounds = this.drawing.getLocalBounds();
    if (this.id && this._controlled) this._refreshFrame(bounds);
    else this.frame.visible = false;

    // Toggle visibility
    this.position.set(this.data.x, this.data.y);
    this.drawing.hitArea = bounds;
    this.alpha = this.data.hidden ? 0.5 : 1.0;
    this.visible = !this.data.hidden || game.user.isGM;
}


function getSceneControlButtons(buttons) {
    let tokenButton = buttons.find(b => b.name == "drawings")

    if (tokenButton) {
        tokenButton.tools.push({
            name: "curved-text-config",
            title: "Curved Text",
            icon: "fas fa-text-width",
            visible: game.user.isGM,
            onClick: () => styleEditor.UpdatePresets(),
            button: true
        });
    }
}

class styleEditor {
    static async UpdatePresets() {
        let presets = await game.settings.get(ModuleName, "presets")
        let content = `<div><select name="presets">${presets?.reduce((acc, preset) => acc += `<option value = ${preset.id}>${preset.name}</option>`, '')}</select></div>`
        let presetSelector = new Dialog({
            title: "Preset Selector",
            content: `<div class="form group"><label> Presets: </label>${content}</div>`,
            buttons: {
                one: {
                    label: "Update",
                    icon: `<i class="fas fa-edit"></i>`,
                    callback: (html) => {
                        let updatePreset = html.find("[name=presets]")[0].value;
                        let preset = presets.find(p => p.id === updatePreset)
                        styleEditor.GeneratePreset(preset, false)
                    }
                },
                two: {
                    label: "Create Copy",
                    icon: `<i class="fas fa-copy"></i>`,
                    callback: (html) => {
                        let updatePreset = html.find("[name=presets]")[0].value;
                        let preset = presets.find(p => p.name === updatePreset)
                        styleEditor.GeneratePreset(preset, true)
                    }
                },
                three: {
                    label: "Delete",
                    icon: `<i class="fas fa-trash-alt"></i>`,
                    callback: (html) => {
                        let updatePreset = html.find("[name=presets]")[0].value;
                        let preset = presets.find(p => p.name === updatePreset)
                        let index = presets.indexOf(preset)
                        let alteredPresets = presets.splice(index, 1)
                        new Dialog({
                            title: "Conformation",
                            content: `Are you sure you want to remove this preset`,
                            buttons: {
                                one: {
                                    label: "Confirm",
                                    icon: `<i class="fas fa-check"></i>`,
                                    callback: () => {
                                        game.settings.set(ModuleName, "presets", presets)
                                    }
                                },
                                two: {
                                    label: "Return",
                                    icon: `<i class="fas fa-undo-alt"></i>`,
                                    callback: presetSelector
                                }
                            }
                        }).render(true)
                    }
                },
                four: {
                    label: "Add New",
                    icon: `<i class="fas fa-plus"></i>`,
                    callback: () => {

                        styleEditor.GeneratePreset()
                    }
                }
            }
        }).render(true)
    }

    static GeneratePreset(preset, copy) {
        let { name, id, autoWrap, duelColor } = preset ?? ""
        if (!id) id = randomID()
        if(copy) id = randomID()
        let { align, fontFamily, fontSize, fontStyle, fontVariant, fontWeight, strokeThickness, fill, fillGradientType, fillGradientStops, dropShadow, dropShadowAlpha, dropShadowAngle, dropShadowBlur, dropShadowColor, dropShadowDistance, wordWrap, wordWrapWidth, leading, letterSpacing } = preset?.style ? preset.style : 0
        switch (copy) {
            case true: name = `${name} (copy)`;
                break;
            case false: name = name;
                break;
            default: name = ""
        }
        if(typeof fill !== "object") fill = [0,0]

        let fontFamilyTypes = `<option selected value="none"> None</option>`
        for (const k of Object.values(CONFIG.fontFamilies)) {
            fontFamilyTypes += `<option value="${k}" ${fontFamily === k ? "selected" : ""}>${k}</option>`;
        }

        let dialogContent = `
        <form>
            <div class="form-group">
                <label>Preset Name</label>
                <input id="name" name="${id}" type="text" value="${name}"></input>
            </div>

            <div class="form-group">
                <label>Align</label>
                <div class="form-fields">
                    <select id="align" name="align">
                        <option value="left" ${align === "normal" ? "checked" : ""}>Left</option>
                        <option value="center" ${align === "center" ? "checked" : ""}>Center</option>
                        <option value="right" ${align === "right" ? "checked" : ""}>Right</option>
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label>Font Family</label>
                <div class="form-fields">
                <select id="fontFamily" name="fontFamily">
                    ${fontFamilyTypes}
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label>Font Size</label>
                <div class="form-fields">
                    <input id="fontSize" name="fontSize" type="Number" min="0" value="${fontSize ?? 80}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Font Style</label>
                <div class="form-fields">
                    <select id="fontStyle" name="fontStyle">
                        <option value="normal" ${fontStyle === "normal" ? "selected" : ""}>Normal</option>
                        <option value="italic" ${fontStyle === "italic" ? "selected" : ""}>Italic</option>
                        <option value="oblique" ${fontStyle === "oblique" ? "selected" : ""}>Oblique</option>
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label>Small Caps</label>
                <div class="form-fields">
                    <input type="checkbox" id="fontVariant" name="fontVariant" ${fontVariant ? "checked" : ""} >
                </div>
            </div>

            <div class="form-group">
                <label>Font Weight</label>
                <div class="form-fields">
                    <select id="fontWeight" name="fontWeight">
                        <option value="normal" ${fontWeight === "normal" ? "selected" : ""}>Normal</option>
                        <option value="bold" ${fontWeight === "bold" ? "checked" : ""}>Bold</option>
                        <option value="bolder" ${fontWeight === "bolder" ? "selected" : ""}>Bolder</option>
                        <option value="lighter" ${fontWeight === "lighter" ? "selected" : ""}>Lighter</option>
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label>Stoke Thickness</label>
                <div class="form-fields">
                    <input id="strokeThickness" name="strokeThickness" type="Number" min="0" value="${strokeThickness ?? 8}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Font Color</label>
                <input type="color" id="fill" name="fill" value="${fill[0] || ""}">
            </div>

            <div class="form-group">
                <label>Secondary Font Color</label>
                <input type="color" id="secondaryFill" name="secondaryFill" value="${fill[1] || ""}">
            </div>

            <div class="form-group">
                <label>Use 2 colors</label>
                <div class="form-fields">
                    <input type="checkbox" id="duelColor" name="duelColor" ${duelColor ? "checked" : ""} >
                </div>
            </div>

            <div class="form-group">
                <label>Color Gradient</label>
                <div class="form-fields">
                    <select id="fillGradientType" name="fillGradientType">
                        <option value="LINEAR_HORIZONTAL" ${fillGradientType === "LINEAR_HORIZONTAL" ? "selected" : ""}>Horizontal</option>
                        <option value="LINEAR_VERTICAL" ${fillGradientType === "LINEAR_VERTICAL" ? "selected" : ""}>Vertical</option>
                    </select>
                </div>
            </div>

            

            <div class="form-group">
                <label>Gradient Alignment</label>
                <div class="form-fields">
                    <input id="fillGradientStops" name="fillGradientStops" type="range" min="0" max="1" step="0.1" value="${fillGradientStops ?? 0.5}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Drop Shadow</label>
                <div class="form-fields">
                    <input type="checkbox" id="dropShadow" name="dropShadow" ${dropShadow ? "checked" : ""} >
                </div>
            </div>

            <div class="form-group">
                <label>Shadow Alpha</label>
                <div class="form-fields">
                    <input id="dropShadowAlpha" name="dropShadowAlpha" type="range" min="0" max="1" step="0.05" value="${dropShadowAlpha ?? 1}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Shadow Blur</label>
                <div class="form-fields">
                    <input id="dropShadowBlur" name="dropShadowBlur" type="Number"  value="${dropShadowBlur ?? 0}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Shadow Angle</label>
                <div class="form-fields">
                    <input id="dropShadowAngle" name="dropShadowAngle" type="Number" value="${dropShadowAngle ?? Math.PI / 6}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Shadow Color</label>
                <input type="color" id="dropShadowColor" name="dropShadowColor" value="${dropShadowColor ?? "#000000"}"></input>
            </div>

            <div class="form-group">
                <label>Shadow Distance</label>
                <div class="form-fields">
                    <input id="dropShadowDistance" name="dropShadowDistance" type="Number" value="${dropShadowDistance ?? 0}"></input>
                </div>
            </div>
            <div class="form-group">
                <label>Word Wrap</label>
                <div class="form-fields">
                    <input type="checkbox" id="wordWrap" name="wordWrap" ${wordWrap ? "checked" : ""} >
                </div>
            </div>

            <div class="form-group">
                <label>Smart Auto Wrap</label>
                <div class="form-fields">
                    <input type="checkbox" id="autoWrap" name="autoWrap" ${autoWrap ? "checked" : ""} >
                </div>
            </div>

            <div class="form-group">
                <label>Word Wrap Distance</label>
                <div class="form-fields">
                    <input id="wordWrapWidth" name="wordWrapWidth" type="Number" value="${wordWrapWidth ?? 1000}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Line Spacing</label>
                <div class="form-fields">
                    <input id="leading" name="leading" type="Number" value="${leading ?? 0}"></input>
                </div>
            </div>

            <div class="form-group">
                <label>Letter Spacing</label>
                <div class="form-fields">
                    <input id="letterSpacing" name="letterSpacing" type="Number" value="${letterSpacing ?? 0}"></input>
                </div>
            </div>

        </form>
            `

        new Dialog({
            title: "Curved Text Presets",
            content: dialogContent,
            buttons: {
                one: {
                    label: "Add Preset",
                    icon: `<i class="fas fa-check"></i>`,
                    callback: async (html) => {
                        let id = html.find("#name")[0].name ?? randomID()
                        let name = html.find("#name")[0].value
                        let align = html.find("#align")[0].value
                        let fontFamily = html.find("#fontFamily")[0].value
                        let fontSize = parseFloat(html.find("#fontSize")[0].value)
                        let fontStyle = html.find("#fontStyle")[0].value
                        let fontVariant = html.find("#fontVariant")[0].value
                        let fontWeight = html.find("#fontWeight")[0].value
                        let strokeThickness = parseFloat(html.find("#strokeThickness")[0].value)
                        let fill = html.find("#fill")[0].value
                        let secondaryFill = html.find("#secondaryFill")[0].value
                        let duelColor = html.find("#duelColor").is(":checked")
                        let fillGradientType = html.find("#fillGradientType")[0].value
                        let fillGradientStops = parseFloat(html.find("#fillGradientStops")[0].value)
                        let dropShadow = html.find("#dropShadow").is(":checked")
                        let dropShadowAngle = parseFloat(html.find("#dropShadowAngle")[0].value)
                        let dropShadowAlpha = parseFloat(html.find("#dropShadowAlpha")[0].value)
                        let dropShadowBlur = parseFloat(html.find("#dropShadowBlur")[0].value)
                        let dropShadowColor = html.find("#dropShadowColor")[0].value
                        let dropShadowDistance = parseFloat(html.find("#dropShadowDistance")[0].value)
                        let wordWrap = html.find("#wordWrap").is(":checked")
                        let wordWrapWidth = parseFloat(html.find("#wordWrapWidth")[0].value)
                        let autoWrap = html.find("#autoWrap").is(":checked")
                        let leading = parseFloat(html.find("#leading")[0].value)
                        let letterSpacing = parseFloat(html.find("#letterSpacing")[0].value)

                        let object = {
                            name: name,
                            id: id,
                            duelColor: duelColor,
                            style: {
                                align: align,
                                fontFamily: fontFamily,
                                fontSize: fontSize,
                                fontStyle: fontStyle,
                                //fontVariant: fontVariant,
                                fontWeight: fontWeight,
                                fill: duelColor ? [fill, secondaryFill] : [fill] ,
                                strokeThickness: strokeThickness,
                                fillGradientType: fillGradientType,
                                fillGradientStops: [fillGradientStops],
                                dropShadow: dropShadow,
                                dropShadowAlpha: dropShadowAlpha,
                                dropShadowColor: dropShadowColor,
                                dropShadowBlur: dropShadowBlur,
                                dropShadowAngle: dropShadowAngle,
                                dropShadowDistance: dropShadowDistance,
                                wordWrap: wordWrap,
                                wordWrapWidth: wordWrapWidth,
                                padding: strokeThickness,
                                leading: leading,
                                letterSpacing: letterSpacing
                            },
                            autoWrap: autoWrap,
                        }
                        if (fillGradientType === "0") delete object.style.fillGradientType
                        styleEditor.AddPreset(name, object)
                    }
                }
            }
        }).render(true)
    }

    static async AddPreset(name, object) {
        if (!name) {
            ui.notifications.error("Please provide a name for the preset")
            return;
        }
        if (!object) {
            ui.notifications.error("Please provide data for the preset")
            return;
        }
        let presets = game.settings.get(ModuleName, "presets");
        let duplicate = presets.find(i => i.name === object.name)
        if (duplicate) {
            let index = presets.indexOf(duplicate)
            if (index > -1) {
                presets.splice(index, 1)
            }
            presets.push(object)
            new Dialog({
                content: `${object.name} is already a preset, confirm overwrite`,
                buttons: {
                    one: {
                        label: "OK",
                        callback: async () => {
                            await game.settings.set(ModuleName, "presets", presets)
                            applyConfig()
                            updateDrawings()
                        }
                    },
                    two: {
                        label: "Return"
                    }
                }
            }).render(true)
        }
        else {
            presets.push(object)
            await game.settings.set(ModuleName, "presets", presets)
            applyConfig()
            updateDrawings()
        }
    }

    static async RemovePreset(name) {
        if (!name) {
            ui.notifications.error("Please provide a name for the preset")
            return;
        }
        let presets = game.settings.get(ModuleName, "presets");
        let removePreset = presets.find(i => i.name === name)
        if (!removePreset) {
            ui.notifications.error("No preset with that name exists")
            return;
        }
        let index = presets.indexOf(removePreset)
        if (index > -1) {
            presets.splice(index, 1)
            ui.notifications.notify(`${removePreset.name} was removed from the presets`)
        }
        await game.settings.set(ModuleName, "presets", presets)
        applyConfig()
        updateDrawings()
    }
}

/**
 * align
 * dropshadow---
 * dropdropShadowAlpha---
 * dropdropShadowAngle---
 * dropdropShadowBlur---
 * dropdropShadowColor---
 * dropShadowDistance---
 * fill---
 * fillGradientType---
 * gillGradientStops---
 * fontFamily---
 * fontSize--
 * fontStyle---
 * fontVariant---
 * fontWeight--
 * leading---
 * letterSpacing---
 * stroke---
 * strokeThickness---
 * wordWrap--
 * wordWrapWidth--
 */