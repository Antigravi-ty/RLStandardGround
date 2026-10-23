import { DEFAULT_PROJECT, createNewLayerTemplate } from './defaultProject.js';
import { Q1_NAMED_ANCHORS } from './physicsData.js';
import { solveThreePointArc } from './geometryMath.js';
import { buildArenaSvgString, getScopeDimensions } from './svgRenderer.js';
import {
  EXPORT_PRESETS,
  resolvePresetDimensions,
  exportProjectJson,
  exportSvgFile,
  exportRasterTexture
} from './exporter.js';

const STORAGE_KEY = 'rl_standard_ground_project_v2';

class GroundStudioApp {
  constructor() {
    this.project = this.loadSavedProject();
    this.selectedLayerId = this.project.layers[0]?.id || null;
    this.viewMode = 'split'; // 'split' (Q1 + Full) | 'full_only' | 'q1_only'
    this.zoomScale = 1.0;
    this.pickTarget = null; // null | 'p1' | 'p2' | 'p3' | 'center'
    this.selectedExportPresetId = EXPORT_PRESETS[0].id; // Proportional Q1 2048px
    this.exportFormat = 'image/webp';
    this.exportWithRef = false;

    this.root = document.getElementById('app');
    this.renderShell();
    this.syncAll();
    this.setupDragAndDrop();
  }

  loadSavedProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.layers)) {
          return {
            ...JSON.parse(JSON.stringify(DEFAULT_PROJECT)),
            ...parsed,
            shaderPreview: { ...DEFAULT_PROJECT.shaderPreview, ...(parsed.shaderPreview || {}) },
            referenceOverlays: { ...DEFAULT_PROJECT.referenceOverlays, ...(parsed.referenceOverlays || {}) }
          };
        }
      }
    } catch (e) {
      console.warn('Failed to load saved project from localStorage:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_PROJECT));
  }

  saveProject() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
    } catch (e) {
      console.warn('localStorage save failed:', e);
    }
  }

  getSelectedLayer() {
    return this.project.layers.find(l => l.id === this.selectedLayerId) || null;
  }

  renderShell() {
    const safeExp = this.project.smallPadSafeExpand ?? 60;
    this.root.innerHTML = `
      <!-- Top Toolbar -->
      <header class="topbar">
        <div class="brand">
          <span>⚽ RLStandardGround Studio</span>
          <span class="brand-badge">1:1 Unreal Units (UU)</span>
        </div>

        <div class="toolbar-group">
          <button class="btn" id="btnViewSplit">双屏对照 (Q1 + 全场对称)</button>
          <button class="btn" id="btnViewFull">仅看完整球场 (4x 对称)</button>
          <button class="btn" id="btnViewQ1">仅看四分之一 (Q1)</button>
          <span style="color:#475569">|</span>
          <label class="checkbox-row" style="background:#1e293b;padding:4px 9px;border-radius:6px;border:1px solid #334155">
            <input type="checkbox" id="chkShaderSim" />
            <span>🎨 游戏 Shader 着色预览 (Ground + Line Tint)</span>
          </label>
        </div>

        <div class="toolbar-group">
          <button class="btn" id="btnUploadFile" title="导入 JSON 参数文件或参考 SVG">📂 导入 JSON / SVG</button>
          <input type="file" id="fileInputHidden" accept=".json,.svg" style="display:none" />
          <button class="btn" id="btnExportJson" title="保存当前所有图层参数为 JSON">💾 导出参数 JSON</button>
          <button class="btn btn-danger" id="btnResetDefault" title="恢复极简默认三图层预设">↺ 重置极简预设</button>
        </div>
      </header>

      <!-- Main 3-Column Workspace -->
      <div class="workspace">
        <!-- Left Sidebar: 1. Actual Drawn Layer Stack, 2. Small Pad Safe Area, 3. Reference Guides & Canvas -->
        <aside class="sidebar">
          <!-- 1. Parametric Layer Stack (What is ACTUALLY drawn on the texture!) -->
          <div class="panel-section">
            <div class="panel-title">
              <span>1. ✏️ 实际绘制的贴图图层 (导出内容)</span>
            </div>
            <div class="hint-box">
              这里才是<b>真正画在贴图上的白色线条</b>。点击下方任一图层即可在右侧调整线宽、内缩距离或 Safe Area 截断。
            </div>
            <div class="field-inline">
              <select id="selNewLayerType" style="flex:1">
                <option value="circle_arc">+ 定点圆 / 极角圆弧 (如连线圆)</option>
                <option value="three_point_arc">+ 三点确定圆弧 (3-Point Arc)</option>
                <option value="rect_or_line">+ 直线段 / 矩形框 (Box/Line)</option>
                <option value="contour_offset">+ 沿地面边界内缩线 (Inset Path)</option>
                <option value="boost_pad_group">+ Boost Pad 判定内收环 (Pad Rings)</option>
                <option value="spawn_marker_group">+ 出生点/复活点地面框 (Spawn Box)</option>
                <option value="turf_stripes">+ 草坪深浅条纹 (Turf Stripes)</option>
              </select>
              <button class="btn btn-primary" id="btnAddLayer">添加</button>
            </div>
            <div class="layer-list" id="layerListContainer"></div>
          </div>

          <!-- 2. Global Small Boost Pad Safe Area Config -->
          <div class="panel-section">
            <div class="panel-title">
              <span>2. 🛡️ Small Boost Pad Safe Area (截断保护区)</span>
            </div>
            <div class="hint-box">
              小氮气垫物理判定半径为 <b>144 UU</b>。设置外扩距离后，开启了「Safe Area 截断」的连线/圆环在进入 <b>R = 144 + 外扩</b> 范围时会自动截断留白。
            </div>
            <div class="field-row">
              <div class="field-label">
                <span>外扩距离 (Outward Expand UU)</span>
                <span class="field-val" id="valSafeExpand">+${safeExp} UU (总 R=${144 + safeExp})</span>
              </div>
              <div class="field-inline">
                <input type="range" id="rngSafeExpand" min="0" max="400" step="4" value="${safeExp}" />
                <input type="number" id="numSafeExpand" value="${safeExp}" min="0" max="600" step="4" style="width:74px" />
              </div>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" id="chkRefSafeArea" />
              <span>🩷 在画布上显示 Safe Area 虚线边界 (仅辅助参考)</span>
            </label>
          </div>

          <!-- 3. Physical Reference Overlays (Non-Exported Guides) -->
          <div class="panel-section">
            <div class="panel-title">
              <span>3. 📐 物理判定参考层 (仅对位，不导出)</span>
            </div>
            <label class="checkbox-row"><input type="checkbox" id="chkRefFlatFloor" /> <span>🟢 Z=0 纯平地面边界 (绿色虚线)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefBoostPads" /> <span>🟡 Boost Pad 拾取判定圆 (R=208 / 144)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefGoalBox" /> <span>🟠 球门框与进球判定线 (Y=5120~6000)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefOuterWall" /> <span>🔵 4096 垂直外墙轮廓 (浅蓝实线)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefSpawns" /> <span>🔴 开球点 &amp; 复活点车体碰撞箱</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefGrid" /> <span>📏 512 / 1024 UU 坐标网格</span></label>
            <div id="customSvgRefRow" style="display:none;border-top:1px dashed #334155;padding-top:6px">
              <label class="checkbox-row"><input type="checkbox" id="chkRefCustomSvg" /> <span>🖼️ 显示导入的外部参考 SVG</span></label>
            </div>
          </div>

          <!-- 4. Canvas Scope & Base Grayscale -->
          <div class="panel-section">
            <div class="panel-title">
              <span>4. 画布范围与基底灰度</span>
            </div>
            <div class="field-row">
              <div class="field-label"><span>Q1 贴图物理范围</span></div>
              <select id="selCanvasScope">
                <option value="pitch_and_goal">含球门全场 (4096 × 6000 UU)</option>
                <option value="pitch_only">纯主场地 4:5 (4096 × 5120 UU)</option>
                <option value="driftwoods_uv">Driftwoods 地面网格 UV (3840 × 5755.61 UU)</option>
              </select>
            </div>
            <div class="field-row">
              <div class="field-label">
                <span>背景基底灰度 (Background Gray)</span>
                <span class="field-val" id="valBgGray">0</span>
              </div>
              <input type="range" id="rngBgGray" min="0" max="255" step="1" value="0" />
            </div>
            <div id="shaderControlsBox" style="display:none;border-top:1px dashed #334155;padding-top:8px;margin-top:4px">
              <div class="field-grid-2">
                <div class="field-row">
                  <div class="field-label"><span>草地底色 (uGroundColor)</span></div>
                  <input type="color" id="colShaderGround" value="#18441c" />
                </div>
                <div class="field-row">
                  <div class="field-label"><span>线条颜色 (uLineColor)</span></div>
                  <input type="color" id="colShaderLine" value="#e1e6eb" />
                </div>
              </div>
              <div class="field-row" style="margin-top:6px">
                <div class="field-label">
                  <span>Shader 阈值 (uLineThreshold)</span>
                  <span class="field-val" id="valShaderThresh">0.13</span>
                </div>
                <input type="range" id="rngShaderThresh" min="0.01" max="0.95" step="0.01" value="0.13" />
              </div>
            </div>
          </div>
        </aside>

        <!-- Center Viewport -->
        <main class="viewport-container">
          <div class="viewport-header">
            <div style="display:flex;align-items:center;gap:12px">
              <span id="lblScopeInfo">画布: 4096 × 6000 UU</span>
              <span class="coord-readout" id="lblCursorCoord">X: 0 UU, Y: 0 UU</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span>缩放:</span>
              <button class="btn" id="btnZoomOut" style="padding:2px 8px">-</button>
              <span id="lblZoom" style="font-family:monospace;min-width:44px;text-align:center">100%</span>
              <button class="btn" id="btnZoomIn" style="padding:2px 8px">+</button>
              <button class="btn" id="btnZoomReset" style="padding:2px 8px">适应窗口</button>
            </div>
          </div>

          <div class="viewport-split" id="viewportSplit">
            <!-- Left Pane: Q1 Editor -->
            <div class="canvas-pane" id="paneQ1">
              <div class="pane-badge">✏️ 四分之一场地编辑区 (Q1: X ∈ [0, 4096], Y ∈ [0, 6000]) — 点击画布可拾取坐标</div>
              <div class="svg-stage" id="stageQ1"></div>
            </div>
            <!-- Right Pane: Full 4x Mirrored Arena Preview -->
            <div class="canvas-pane" id="paneFull">
              <div class="pane-badge">🔍 完整球场实时 2 次镜像预览 (8192 × 12000 UU)</div>
              <div class="svg-stage" id="stageFull"></div>
            </div>
          </div>
        </main>

        <!-- Right Sidebar: Selected Layer Inspector & Multi-Spec Texture Exporter -->
        <aside class="sidebar-right">
          <!-- Selected Layer Inspector -->
          <div class="panel-section" id="inspectorPanel">
            <div class="panel-title">
              <span>🛠️ 当前选中图层参数</span>
              <div style="display:flex;gap:4px">
                <button class="btn" id="btnDuplicateLayer" style="padding:2px 7px;font-size:11px">复制图层</button>
                <button class="btn btn-danger" id="btnDeleteLayer" style="padding:2px 7px;font-size:11px">删除</button>
              </div>
            </div>
            <div id="inspectorBody"></div>
          </div>

          <!-- Export Panel -->
          <div class="panel-section">
            <div class="panel-title">
              <span>🚀 导出 WebP / PNG / SVG 贴图</span>
            </div>
            <div class="field-row">
              <div class="field-label"><span>常用导出规格预设 (推荐按真实比例无拉伸)</span></div>
              <select id="selExportPreset">
                ${EXPORT_PRESETS.map(p => `<option value="${p.id}" ${p.id === this.selectedExportPresetId ? 'selected' : ''}>${p.label}</option>`).join('')}
              </select>
            </div>
            <div class="field-grid-2">
              <div class="field-row">
                <div class="field-label"><span>输出宽度 (px)</span></div>
                <input type="number" id="inpExportW" value="2048" min="64" max="8192" step="64" />
              </div>
              <div class="field-row">
                <div class="field-label"><span>输出高度 (px)</span></div>
                <input type="number" id="inpExportH" value="3000" min="64" max="12000" step="64" />
              </div>
            </div>
            <div class="field-grid-2">
              <div class="field-row">
                <div class="field-label"><span>导出范围</span></div>
                <select id="selExportMode">
                  <option value="q1">四分之一场地 (Q1)</option>
                  <option value="full_mirror">完整场地 (4x对称)</option>
                </select>
              </div>
              <div class="field-row">
                <div class="field-label"><span>图片格式</span></div>
                <select id="selExportFormat">
                  <option value="image/webp" selected>WebP (推荐高压缩)</option>
                  <option value="image/png">PNG (无损灰度)</option>
                </select>
              </div>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" id="chkExportWithRef" />
              <span>导出时包含物理参考线 (默认不勾选，仅导纯净贴图)</span>
            </label>
            <div style="display:flex;flex-direction:column;gap:7px;margin-top:4px">
              <button class="btn btn-emerald" id="btnExportRaster" style="justify-content:center;padding:9px;font-size:13px;font-weight:700">
                🖼️ 导出光栅贴图 (WebP / PNG)
              </button>
              <div class="field-grid-2">
                <button class="btn" id="btnExportSvgQ1" style="justify-content:center">📐 导出 Q1 SVG</button>
                <button class="btn" id="btnExportSvgFull" style="justify-content:center">📐 导出全场 SVG</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    `;

    this.bindShellEvents();
  }

  bindShellEvents() {
    const setView = (mode) => {
      this.viewMode = mode;
      this.updateViewModeUI();
    };
    document.getElementById('btnViewSplit').onclick = () => setView('split');
    document.getElementById('btnViewFull').onclick = () => setView('full_only');
    document.getElementById('btnViewQ1').onclick = () => setView('q1_only');

    // Global Small Pad Safe Area Expand controls
    const rngSafe = document.getElementById('rngSafeExpand');
    const numSafe = document.getElementById('numSafeExpand');
    const valSafe = document.getElementById('valSafeExpand');
    const updateSafeExpand = (v) => {
      const val = Math.max(0, parseFloat(v) || 0);
      this.project.smallPadSafeExpand = val;
      rngSafe.value = val;
      numSafe.value = val;
      valSafe.textContent = `+${val} UU (总 R=${144 + val})`;
      this.saveAndRenderCanvas();
    };
    rngSafe.oninput = (e) => updateSafeExpand(e.target.value);
    numSafe.oninput = (e) => updateSafeExpand(e.target.value);

    // Shader sim toggle
    const chkShader = document.getElementById('chkShaderSim');
    chkShader.checked = Boolean(this.project.shaderPreview.enabled);
    chkShader.onchange = (e) => {
      this.project.shaderPreview.enabled = e.target.checked;
      document.getElementById('shaderControlsBox').style.display = e.target.checked ? 'block' : 'none';
      this.saveAndRenderCanvas();
    };

    document.getElementById('colShaderGround').oninput = (e) => {
      this.project.shaderPreview.groundColor = e.target.value;
      this.saveAndRenderCanvas();
    };
    document.getElementById('colShaderLine').oninput = (e) => {
      this.project.shaderPreview.lineColor = e.target.value;
      this.saveAndRenderCanvas();
    };
    document.getElementById('rngShaderThresh').oninput = (e) => {
      this.project.shaderPreview.threshold = parseFloat(e.target.value);
      document.getElementById('valShaderThresh').textContent = e.target.value;
      this.saveAndRenderCanvas();
    };

    // Canvas Scope & Background Gray
    const selScope = document.getElementById('selCanvasScope');
    selScope.value = this.project.canvasScope;
    selScope.onchange = (e) => {
      this.project.canvasScope = e.target.value;
      this.syncExportPresetInputs();
      this.saveAndRenderCanvas();
    };

    const rngBg = document.getElementById('rngBgGray');
    rngBg.value = this.project.backgroundGray ?? 0;
    document.getElementById('valBgGray').textContent = rngBg.value;
    rngBg.oninput = (e) => {
      this.project.backgroundGray = parseInt(e.target.value, 10);
      document.getElementById('valBgGray').textContent = e.target.value;
      this.saveAndRenderCanvas();
    };

    // Reference Overlays
    const bindRefCheck = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.checked = Boolean(this.project.referenceOverlays[key]);
      el.onchange = (e) => {
        this.project.referenceOverlays[key] = e.target.checked;
        this.saveAndRenderCanvas();
      };
    };
    bindRefCheck('chkRefSafeArea', 'showSmallPadSafeArea');
    bindRefCheck('chkRefFlatFloor', 'showFlatFloorZ0');
    bindRefCheck('chkRefOuterWall', 'showOuterWall');
    bindRefCheck('chkRefGoalBox', 'showGoalBox');
    bindRefCheck('chkRefBoostPads', 'showBoostPads');
    bindRefCheck('chkRefSpawns', 'showSpawns');
    bindRefCheck('chkRefGrid', 'showGrid');
    bindRefCheck('chkRefCustomSvg', 'customSvgVisible');

    // Add Layer
    document.getElementById('btnAddLayer').onclick = () => {
      const type = document.getElementById('selNewLayerType').value;
      const newLayer = createNewLayerTemplate(type, this.project.layers.length + 1);
      this.project.layers.push(newLayer);
      this.selectedLayerId = newLayer.id;
      this.syncAll();
    };

    // Duplicate & Delete Layer
    document.getElementById('btnDuplicateLayer').onclick = () => {
      const cur = this.getSelectedLayer();
      if (!cur) return;
      const copy = JSON.parse(JSON.stringify(cur));
      copy.id = `${cur.id}_copy_${Date.now()}`;
      copy.name = `${cur.name} (副本)`;
      const idx = this.project.layers.findIndex(l => l.id === cur.id);
      this.project.layers.splice(idx + 1, 0, copy);
      this.selectedLayerId = copy.id;
      this.syncAll();
    };

    document.getElementById('btnDeleteLayer').onclick = () => {
      if (this.project.layers.length <= 1) return;
      const idx = this.project.layers.findIndex(l => l.id === this.selectedLayerId);
      if (idx >= 0) {
        this.project.layers.splice(idx, 1);
        this.selectedLayerId = this.project.layers[Math.max(0, idx - 1)]?.id || null;
        this.syncAll();
      }
    };

    // Zoom buttons
    const applyZoom = (z) => {
      this.zoomScale = Math.max(0.4, Math.min(4.0, z));
      document.getElementById('lblZoom').textContent = `${Math.round(this.zoomScale * 100)}%`;
      this.applyZoomToStages();
    };
    document.getElementById('btnZoomOut').onclick = () => applyZoom(this.zoomScale - 0.25);
    document.getElementById('btnZoomIn').onclick = () => applyZoom(this.zoomScale + 0.25);
    document.getElementById('btnZoomReset').onclick = () => applyZoom(1.0);

    // Import / Export / Reset
    const fileInput = document.getElementById('fileInputHidden');
    document.getElementById('btnUploadFile').onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      if (e.target.files?.[0]) this.handleImportedFile(e.target.files[0]);
      fileInput.value = '';
    };

    document.getElementById('btnExportJson').onclick = () => exportProjectJson(this.project);
    document.getElementById('btnResetDefault').onclick = () => {
      this.project = JSON.parse(JSON.stringify(DEFAULT_PROJECT));
      this.selectedLayerId = this.project.layers[0]?.id || null;
      const safeVal = this.project.smallPadSafeExpand ?? 60;
      document.getElementById('rngSafeExpand').value = safeVal;
      document.getElementById('numSafeExpand').value = safeVal;
      document.getElementById('valSafeExpand').textContent = `+${safeVal} UU (总 R=${144 + safeVal})`;
      this.syncAll();
    };

    // Export Presets
    const selPreset = document.getElementById('selExportPreset');
    selPreset.onchange = (e) => {
      this.selectedExportPresetId = e.target.value;
      this.syncExportPresetInputs();
    };

    document.getElementById('btnExportRaster').onclick = () => {
      const w = parseInt(document.getElementById('inpExportW').value, 10) || 2048;
      const h = parseInt(document.getElementById('inpExportH').value, 10) || 3000;
      const mode = document.getElementById('selExportMode').value;
      const format = document.getElementById('selExportFormat').value;
      const includeReference = document.getElementById('chkExportWithRef').checked;
      exportRasterTexture(this.project, {
        mode,
        width: w,
        height: h,
        format,
        useShaderPreview: Boolean(this.project.shaderPreview.enabled),
        includeReference
      });
    };

    document.getElementById('btnExportSvgQ1').onclick = () => {
      exportSvgFile(this.project, 'q1', document.getElementById('chkExportWithRef').checked);
    };
    document.getElementById('btnExportSvgFull').onclick = () => {
      exportSvgFile(this.project, 'full_mirror', document.getElementById('chkExportWithRef').checked);
    };

    this.syncExportPresetInputs();
  }

  syncExportPresetInputs() {
    const preset = EXPORT_PRESETS.find(p => p.id === this.selectedExportPresetId) || EXPORT_PRESETS[0];
    const { width, height, mode } = resolvePresetDimensions(this.project, preset);
    document.getElementById('inpExportW').value = width;
    document.getElementById('inpExportH').value = height;
    document.getElementById('selExportMode').value = mode;
  }

  updateViewModeUI() {
    document.getElementById('btnViewSplit').classList.toggle('active', this.viewMode === 'split');
    document.getElementById('btnViewFull').classList.toggle('active', this.viewMode === 'full_only');
    document.getElementById('btnViewQ1').classList.toggle('active', this.viewMode === 'q1_only');

    const paneQ1 = document.getElementById('paneQ1');
    const paneFull = document.getElementById('paneFull');
    paneQ1.style.display = this.viewMode === 'full_only' ? 'none' : 'flex';
    paneFull.style.display = this.viewMode === 'q1_only' ? 'none' : 'flex';
  }

  syncAll() {
    this.updateViewModeUI();
    this.renderLayerList();
    this.renderInspector();
    this.saveAndRenderCanvas();
  }

  renderLayerList() {
    const container = document.getElementById('layerListContainer');
    container.innerHTML = '';

    this.project.layers.forEach((layer, idx) => {
      const div = document.createElement('div');
      div.className = `layer-item ${layer.id === this.selectedLayerId ? 'selected' : ''}`;

      const badgeMap = {
        contour_offset: '边界线',
        circle_arc: '圆/弧',
        three_point_arc: '三点弧',
        rect_or_line: '框/线',
        boost_pad_group: '垫子环',
        spawn_marker_group: '出生点',
        turf_stripes: '条纹'
      };

      div.innerHTML = `
        <div class="layer-left">
          <input type="checkbox" class="layer-vis-chk" ${layer.visible ? 'checked' : ''} title="显示/隐藏该图层" />
          <span class="layer-type-badge">${badgeMap[layer.type] || layer.type}</span>
          <span class="layer-name">${layer.name}</span>
        </div>
        <div class="layer-actions">
          <button class="icon-btn btn-up" title="上移">▲</button>
          <button class="icon-btn btn-down" title="下移">▼</button>
        </div>
      `;

      div.onclick = (e) => {
        if (e.target.classList.contains('layer-vis-chk') || e.target.classList.contains('icon-btn')) return;
        this.selectedLayerId = layer.id;
        this.pickTarget = null;
        this.renderLayerList();
        this.renderInspector();
        this.saveAndRenderCanvas();
      };

      const chk = div.querySelector('.layer-vis-chk');
      chk.onchange = (e) => {
        layer.visible = e.target.checked;
        this.saveAndRenderCanvas();
      };

      div.querySelector('.btn-up').onclick = () => {
        if (idx > 0) {
          const tmp = this.project.layers[idx - 1];
          this.project.layers[idx - 1] = this.project.layers[idx];
          this.project.layers[idx] = tmp;
          this.renderLayerList();
          this.saveAndRenderCanvas();
        }
      };

      div.querySelector('.btn-down').onclick = () => {
        if (idx < this.project.layers.length - 1) {
          const tmp = this.project.layers[idx + 1];
          this.project.layers[idx + 1] = this.project.layers[idx];
          this.project.layers[idx] = tmp;
          this.renderLayerList();
          this.saveAndRenderCanvas();
        }
      };

      container.appendChild(div);
    });
  }

  renderInspector() {
    const body = document.getElementById('inspectorBody');
    const layer = this.getSelectedLayer();
    if (!layer) {
      body.innerHTML = `<div style="color:#9ca3af;font-size:12px">请在左侧选择一个图层</div>`;
      return;
    }

    let html = `
      <div class="field-row">
        <div class="field-label"><span>图层名称</span></div>
        <input type="text" id="inspName" value="${layer.name}" />
      </div>
    `;

    // Safe Area Truncation Toggle (applicable to all line/arc/contour/rect layers)
    if (layer.type !== 'boost_pad_group' && layer.type !== 'turf_stripes') {
      html += `
        <label class="checkbox-row" style="background:rgba(236,72,153,0.12);border:1px solid rgba(244,114,182,0.4);padding:6px 8px;border-radius:6px">
          <input type="checkbox" id="chkCutBySafeArea" ${layer.cutBySmallPadSafeArea ? 'checked' : ''} />
          <span>✂️ 被 Small Boost Pad Safe Area 截断 (进入保护区不画线)</span>
        </label>
      `;
    }

    if (layer.type === 'contour_offset') {
      html += `
        <div class="field-row">
          <div class="field-label"><span>基准轮廓线 (Base Contour)</span></div>
          <select id="inspBaseContour">
            <option value="full_flat_floor" ${layer.baseContour === 'full_flat_floor' ? 'selected' : ''}>🟢 Z=0 纯平含球门边界 (完整贴合绿虚线)</option>
            <option value="pitch_flat_floor" ${layer.baseContour === 'pitch_flat_floor' ? 'selected' : ''}>🟢 Z=0 纯平主场地边界 (球门线处闭合)</option>
            <option value="pitch_outer_wall" ${layer.baseContour === 'pitch_outer_wall' ? 'selected' : ''}>🔵 4096×5120 垂直外墙轮廓</option>
            <option value="outer_wall" ${layer.baseContour === 'outer_wall' ? 'selected' : ''}>🔵 4096×6000 含球门外墙轮廓</option>
          </select>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="chkHugInner" ${layer.hugInnerEdge !== false ? 'checked' : ''} />
          <span>紧贴基准线内侧 (自动将中心路径内缩 线宽/2)</span>
        </label>
        <div class="field-row">
          <div class="field-label">
            <span>额外向内收缩距离 (Extra Inset UU, 0=紧贴)</span>
            <span class="field-val" id="lblInsetDist">${layer.insetDist} UU</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngInsetDist" min="-100" max="1000" step="2" value="${layer.insetDist}" />
            <input type="number" id="numInsetDist" value="${layer.insetDist}" style="width:78px" />
          </div>
        </div>
      `;
    } else if (layer.type === 'circle_arc') {
      html += `
        <div class="field-row">
          <div class="field-label"><span>快速吸附到物理锚点 (Snap Anchor)</span></div>
          <select id="inspAnchorSelect">
            <option value="custom">-- 自定义圆心坐标 (或点击 Q1 画布拾取) --</option>
            ${Q1_NAMED_ANCHORS.map(a => `<option value="${a.id}" ${(Math.abs(layer.cx - a.x) < 1 && Math.abs(layer.cy - a.y) < 1) ? 'selected' : ''}>${a.label}</option>`).join('')}
          </select>
        </div>
        <div class="field-grid-2">
          <div class="field-row">
            <div class="field-label"><span>圆心 X (UU)</span></div>
            <input type="number" id="numCx" value="${layer.cx}" step="8" />
          </div>
          <div class="field-row">
            <div class="field-label"><span>圆心 Y (UU)</span></div>
            <input type="number" id="numCy" value="${layer.cy}" step="8" />
          </div>
        </div>
        <button class="btn ${this.pickTarget === 'center' ? 'active' : ''}" id="btnPickCenter" style="width:100%;justify-content:center">
          🎯 点击 Q1 画布直接拾取圆心 (cx, cy)
        </button>
        <div class="field-row">
          <div class="field-label">
            <span>圆弧半径 (Radius UU, 如 1024 连四小垫)</span>
            <span class="field-val" id="lblRadius">${layer.radius} UU</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngRadius" min="10" max="4096" step="4" value="${layer.radius}" />
            <input type="number" id="numRadius" value="${layer.radius}" style="width:78px" />
          </div>
        </div>
        <div class="field-grid-2">
          <div class="field-row">
            <div class="field-label"><span>起始角 (°) [0=+X, 90=+Y]</span></div>
            <input type="number" id="numStartDeg" value="${layer.startDeg}" min="-360" max="360" step="5" />
          </div>
          <div class="field-row">
            <div class="field-label"><span>终止角 (°)</span></div>
            <input type="number" id="numEndDeg" value="${layer.endDeg}" min="-360" max="360" step="5" />
          </div>
        </div>
      `;
    } else if (layer.type === 'three_point_arc') {
      const solved = solveThreePointArc(
        Number(layer.x1) || 0, Number(layer.y1) || 0,
        Number(layer.x2) || 0, Number(layer.y2) || 0,
        Number(layer.x3) || 0, Number(layer.y3) || 0,
        Boolean(layer.fullCircle)
      );
      html += `
        <div class="hint-box">
          📐 <b>三点定圆弧解算结果</b>：<br/>
          ${solved.collinear ? '三点共线 (已退化为直线段)' : `圆心: (${Math.round(solved.cx)}, ${Math.round(solved.cy)}) UU | 半径 R = <b>${solved.r.toFixed(1)} UU</b>`}
        </div>
        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>起点 P1.X</span></div><input type="number" id="numP1X" value="${layer.x1}" step="10" /></div>
          <div class="field-row"><div class="field-label"><span>起点 P1.Y</span></div><input type="number" id="numP1Y" value="${layer.y1}" step="10" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'p1' ? 'active' : ''}" id="btnPickP1" style="justify-content:center">🟢 在画布上点选起点 P1</button>

        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>经过点 P2.X</span></div><input type="number" id="numP2X" value="${layer.x2}" step="10" /></div>
          <div class="field-row"><div class="field-label"><span>经过点 P2.Y</span></div><input type="number" id="numP2Y" value="${layer.y2}" step="10" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'p2' ? 'active' : ''}" id="btnPickP2" style="justify-content:center">🟡 在画布上点选中间点 P2</button>

        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>终点 P3.X</span></div><input type="number" id="numP3X" value="${layer.x3}" step="10" /></div>
          <div class="field-row"><div class="field-label"><span>终点 P3.Y</span></div><input type="number" id="numP3Y" value="${layer.y3}" step="10" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'p3' ? 'active' : ''}" id="btnPickP3" style="justify-content:center">🟣 在画布上点选终点 P3</button>

        <label class="checkbox-row">
          <input type="checkbox" id="chk3PtFullCircle" ${layer.fullCircle ? 'checked' : ''} />
          <span>闭合为完整整圆 (Full Circle)</span>
        </label>
      `;
    } else if (layer.type === 'rect_or_line') {
      html += `
        <div class="field-row">
          <div class="field-label"><span>几何子类型</span></div>
          <select id="inspRectSubMode">
            <option value="hline_y0" ${layer.subMode === 'hline_y0' ? 'selected' : ''}>水平直线 (如 Y=0 中场线)</option>
            <option value="vline_x0" ${layer.subMode === 'vline_x0' ? 'selected' : ''}>垂直直线 (如 X=0 中轴线)</option>
            <option value="custom_segment" ${layer.subMode === 'custom_segment' ? 'selected' : ''}>任意两点直线段 (X1,Y1 → X2,Y2)</option>
            <option value="rect_box" ${layer.subMode === 'rect_box' ? 'selected' : ''}>矩形框 / 禁区框 (Rect Box)</option>
          </select>
        </div>
        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>X1 (左/起点 UU)</span></div><input type="number" id="numRectX1" value="${layer.x1}" step="16" /></div>
          <div class="field-row"><div class="field-label"><span>Y1 (上/起点 UU)</span></div><input type="number" id="numRectY1" value="${layer.y1}" step="16" /></div>
          <div class="field-row"><div class="field-label"><span>X2 (右/终点 UU)</span></div><input type="number" id="numRectX2" value="${layer.x2}" step="16" /></div>
          <div class="field-row"><div class="field-label"><span>Y2 (下/终点 UU)</span></div><input type="number" id="numRectY2" value="${layer.y2}" step="16" /></div>
        </div>
        <div class="field-row">
          <div class="field-label"><span>圆角半径 (Corner Radius UU)</span></div>
          <input type="number" id="numCornerRad" value="${layer.cornerRadius || 0}" min="0" max="1000" step="8" />
        </div>
      `;
    } else if (layer.type === 'boost_pad_group') {
      const inW = layer.inwardWidth ?? layer.strokeWidth ?? 20;
      const inOff = layer.insetFromPickup ?? 0;
      html += `
        <div class="hint-box">
          💡 <b>向内收环模式</b>：大垫子判定圆 <b>R=208</b> (当前绘制 <b>${208 - inOff - inW}~${208 - inOff} UU</b>)，小垫子判定圆 <b>R=144</b> (当前绘制 <b>${144 - inOff - inW}~${144 - inOff} UU</b>)。
        </div>
        <div class="field-row">
          <div class="field-label"><span>作用目标垫子 (Target Pads)</span></div>
          <select id="inspTargetPads">
            <option value="both" ${layer.targetPads === 'both' ? 'selected' : ''}>全部氮气垫 (Big R=208 + Small R=144)</option>
            <option value="big" ${layer.targetPads === 'big' ? 'selected' : ''}>仅大氮气垫 (Big Pads, 判定 R=208)</option>
            <option value="small" ${layer.targetPads === 'small' ? 'selected' : ''}>仅小氮气垫 (Small Pads, 判定 R=144)</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field-label">
            <span>向内收线条宽度 (Inward Width UU)</span>
            <span class="field-val" id="lblInwardW">${inW} UU</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngInwardW" min="2" max="120" step="2" value="${inW}" />
            <input type="number" id="numInwardW" value="${inW}" style="width:74px" />
          </div>
        </div>
        <div class="field-row">
          <div class="field-label">
            <span>距判定圆外缘退让 (0 = 最外圈紧贴判定边缘)</span>
          </div>
          <input type="number" id="numInsetFromPickup" value="${inOff}" min="-100" max="150" step="2" />
        </div>
      `;
    } else if (layer.type === 'spawn_marker_group') {
      html += `
        <div class="field-row">
          <div class="field-label"><span>目标位置</span></div>
          <select id="inspTargetSpawns">
            <option value="both" ${layer.targetSpawns === 'both' ? 'selected' : ''}>开球出生点 + Demo 复活点</option>
            <option value="kickoff" ${layer.targetSpawns === 'kickoff' ? 'selected' : ''}>仅开球出生点 (Kickoff Spawns)</option>
            <option value="demo" ${layer.targetSpawns === 'demo' ? 'selected' : ''}>仅被炸复活点 (Demo Respawn Slots)</option>
          </select>
        </div>
        <div class="field-grid-2">
          <div class="field-row">
            <div class="field-label"><span>标记形状</span></div>
            <select id="inspSpawnShape">
              <option value="hitbox_outline" ${layer.shape === 'hitbox_outline' ? 'selected' : ''}>车体碰撞箱矩形</option>
              <option value="circle" ${layer.shape === 'circle' ? 'selected' : ''}>圆形标记</option>
              <option value="crosshair" ${layer.shape === 'crosshair' ? 'selected' : ''}>十字准星</option>
            </select>
          </div>
          <div class="field-row">
            <div class="field-label"><span>外扩边距 (Margin UU)</span></div>
            <input type="number" id="numSpawnMargin" value="${layer.expandMargin ?? 16}" step="4" />
          </div>
        </div>
      `;
    } else if (layer.type === 'turf_stripes') {
      html += `
        <div class="field-grid-2">
          <div class="field-row">
            <div class="field-label"><span>条纹方向</span></div>
            <select id="inspStripeOrient">
              <option value="horizontal" ${layer.orientation === 'horizontal' ? 'selected' : ''}>横向草坪条纹 (沿 Y 轴交替)</option>
              <option value="vertical" ${layer.orientation === 'vertical' ? 'selected' : ''}>纵向条纹 (沿 X 轴交替)</option>
            </select>
          </div>
          <div class="field-row">
            <div class="field-label"><span>周期跨度 (Span UU)</span></div>
            <input type="number" id="numStripeSpan" value="${layer.stripeSpan ?? 512}" min="64" max="2048" step="64" />
          </div>
        </div>
        <div class="field-row">
          <div class="field-label"><span>边界内缩裁剪距离 (Inset from Z=0 Floor)</span></div>
          <input type="number" id="numTurfInset" value="${layer.insetFromFloor ?? 20}" min="-256" max="1000" step="10" />
        </div>
      `;
    }

    // Common Stroke, Grayscale, Dash & Clip Box Controls
    if (layer.type !== 'turf_stripes') {
      const showStrokeSlider = layer.type !== 'boost_pad_group';
      html += `
        <div style="border-top:1px solid #334155;margin-top:6px;padding-top:8px;display:flex;flex-direction:column;gap:8px">
          ${showStrokeSlider ? `
          <div class="field-row">
            <div class="field-label">
              <span>线条宽度 (Stroke Width UU)</span>
              <span class="field-val" id="lblStrokeW">${layer.strokeWidth ?? 20} UU</span>
            </div>
            <div class="field-inline">
              <input type="range" id="rngStrokeW" min="0" max="250" step="2" value="${layer.strokeWidth ?? 20}" />
              <input type="number" id="numStrokeW" value="${layer.strokeWidth ?? 20}" style="width:70px" />
            </div>
          </div>` : ''}

          <div class="field-row">
            <div class="field-label">
              <span>线条灰度值 (Grayscale 0=黑 .. 255=白)</span>
              <span class="field-val" id="lblGray">${layer.gray ?? 255}</span>
            </div>
            <div class="field-inline">
              <input type="range" id="rngGray" min="0" max="255" step="1" value="${layer.gray ?? 255}" />
              <input type="number" id="numGray" value="${layer.gray ?? 255}" min="0" max="255" style="width:70px" />
            </div>
          </div>

          <div class="field-grid-2">
            <div class="field-row">
              <div class="field-label"><span>虚线实长 (Dash UU, 0=实线)</span></div>
              <input type="number" id="numDashLen" value="${layer.dashLength || 0}" min="0" max="1000" step="10" />
            </div>
            <div class="field-row">
              <div class="field-label"><span>虚线空隙 (Gap UU)</span></div>
              <input type="number" id="numGapLen" value="${layer.gapLength || 0}" min="0" max="1000" step="10" />
            </div>
          </div>

          <div class="field-row">
            <div class="field-label"><span>内部填充灰度 (-1 = 无填充透明, 0..255 = 填充灰度)</span></div>
            <input type="number" id="numFillGray" value="${layer.fillGray ?? -1}" min="-1" max="255" step="5" />
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="field-row">
          <div class="field-label">
            <span>条纹灰度值 (Grayscale 0..255)</span>
            <span class="field-val" id="lblGray">${layer.gray ?? 12}</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngGray" min="0" max="255" step="1" value="${layer.gray ?? 12}" />
            <input type="number" id="numGray" value="${layer.gray ?? 12}" min="0" max="255" style="width:70px" />
          </div>
        </div>
      `;
    }

    // Rectangular Clipping Region
    html += `
      <div style="border-top:1px solid #334155;margin-top:6px;padding-top:8px">
        <div class="field-label" style="margin-bottom:6px;color:#93c5fd">✂️ 矩形裁剪区域 (Clip Box — 超出此范围自动截断)</div>
        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>Clip X Min</span></div><input type="number" id="numClipXMin" value="${layer.clipXMin ?? 0}" step="32" /></div>
          <div class="field-row"><div class="field-label"><span>Clip X Max</span></div><input type="number" id="numClipXMax" value="${layer.clipXMax ?? 4096}" step="32" /></div>
          <div class="field-row"><div class="field-label"><span>Clip Y Min</span></div><input type="number" id="numClipYMin" value="${layer.clipYMin ?? 0}" step="32" /></div>
          <div class="field-row"><div class="field-label"><span>Clip Y Max</span></div><input type="number" id="numClipYMax" value="${layer.clipYMax ?? 6000}" step="32" /></div>
        </div>
      </div>
    `;

    body.innerHTML = html;
    this.bindInspectorEvents(layer);
  }

  bindInspectorEvents(layer) {
    const bindVal = (id, prop, isNum = true, rerenderInspector = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.oninput = (e) => {
        layer[prop] = isNum ? parseFloat(e.target.value) || 0 : e.target.value;
        if (prop === 'name') this.renderLayerList();
        if (rerenderInspector) this.renderInspector();
        this.saveAndRenderCanvas();
      };
    };

    bindVal('inspName', 'name', false);

    const chkCutSafe = document.getElementById('chkCutBySafeArea');
    if (chkCutSafe) {
      chkCutSafe.onchange = (e) => {
        layer.cutBySmallPadSafeArea = e.target.checked;
        this.saveAndRenderCanvas();
      };
    }

    const chkHugInner = document.getElementById('chkHugInner');
    if (chkHugInner) {
      chkHugInner.onchange = (e) => {
        layer.hugInnerEdge = e.target.checked;
        this.saveAndRenderCanvas();
      };
    }

    const bindPair = (rngId, numId, lblId, prop, unit = '', rerender = false) => {
      const rng = document.getElementById(rngId);
      const num = document.getElementById(numId);
      const lbl = document.getElementById(lblId);
      if (!rng || !num) return;
      const update = (val) => {
        const v = parseFloat(val) || 0;
        layer[prop] = v;
        rng.value = v;
        num.value = v;
        if (lbl) lbl.textContent = `${v}${unit}`;
        if (rerender) this.renderInspector();
        this.saveAndRenderCanvas();
      };
      rng.oninput = (e) => update(e.target.value);
      num.oninput = (e) => update(e.target.value);
    };

    bindPair('rngInsetDist', 'numInsetDist', 'lblInsetDist', 'insetDist', ' UU');
    bindPair('rngRadius', 'numRadius', 'lblRadius', 'radius', ' UU');
    bindPair('rngInwardW', 'numInwardW', 'lblInwardW', 'inwardWidth', ' UU', true);
    bindPair('rngStrokeW', 'numStrokeW', 'lblStrokeW', 'strokeWidth', ' UU');
    bindPair('rngGray', 'numGray', 'lblGray', 'gray', '');

    bindVal('inspBaseContour', 'baseContour', false);
    bindVal('numCx', 'cx', true);
    bindVal('numCy', 'cy', true);
    bindVal('numStartDeg', 'startDeg', true);
    bindVal('numEndDeg', 'endDeg', true);

    const selAnchor = document.getElementById('inspAnchorSelect');
    if (selAnchor) {
      selAnchor.onchange = (e) => {
        const found = Q1_NAMED_ANCHORS.find(a => a.id === e.target.value);
        if (found) {
          layer.cx = found.x;
          layer.cy = found.y;
          this.renderInspector();
          this.saveAndRenderCanvas();
        }
      };
    }

    const bindPickBtn = (btnId, targetKey) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.onclick = () => {
        this.pickTarget = this.pickTarget === targetKey ? null : targetKey;
        this.renderInspector();
      };
    };
    bindPickBtn('btnPickCenter', 'center');
    bindPickBtn('btnPickP1', 'p1');
    bindPickBtn('btnPickP2', 'p2');
    bindPickBtn('btnPickP3', 'p3');

    bindVal('numP1X', 'x1', true, true);
    bindVal('numP1Y', 'y1', true, true);
    bindVal('numP2X', 'x2', true, true);
    bindVal('numP2Y', 'y2', true, true);
    bindVal('numP3X', 'x3', true, true);
    bindVal('numP3Y', 'y3', true, true);

    const chk3Pt = document.getElementById('chk3PtFullCircle');
    if (chk3Pt) {
      chk3Pt.onchange = (e) => {
        layer.fullCircle = e.target.checked;
        this.saveAndRenderCanvas();
      };
    }

    bindVal('inspRectSubMode', 'subMode', false);
    bindVal('numRectX1', 'x1', true);
    bindVal('numRectY1', 'y1', true);
    bindVal('numRectX2', 'x2', true);
    bindVal('numRectY2', 'y2', true);
    bindVal('numCornerRad', 'cornerRadius', true);

    bindVal('inspTargetPads', 'targetPads', false);
    bindVal('numInsetFromPickup', 'insetFromPickup', true, true);

    bindVal('inspTargetSpawns', 'targetSpawns', false);
    bindVal('inspSpawnShape', 'shape', false);
    bindVal('numSpawnMargin', 'expandMargin', true);

    bindVal('inspStripeOrient', 'orientation', false);
    bindVal('numStripeSpan', 'stripeSpan', true);
    bindVal('numTurfInset', 'insetFromFloor', true);

    bindVal('numDashLen', 'dashLength', true);
    bindVal('numGapLen', 'gapLength', true);
    bindVal('numFillGray', 'fillGray', true);

    bindVal('numClipXMin', 'clipXMin', true);
    bindVal('numClipXMax', 'clipXMax', true);
    bindVal('numClipYMin', 'clipYMin', true);
    bindVal('numClipYMax', 'clipYMax', true);
  }

  saveAndRenderCanvas() {
    this.saveProject();
    const { w: scopeW, h: scopeH, label } = getScopeDimensions(this.project.canvasScope);
    document.getElementById('lblScopeInfo').textContent = `Q1 画布: ${label}`;

    const useShader = Boolean(this.project.shaderPreview.enabled);
    const svgQ1 = buildArenaSvgString(this.project, {
      mode: 'q1',
      includeReference: true,
      useShaderPreview: useShader,
      activeLayerId: this.selectedLayerId
    });
    const svgFull = buildArenaSvgString(this.project, {
      mode: 'full_mirror',
      includeReference: true,
      useShaderPreview: useShader,
      activeLayerId: this.selectedLayerId
    });

    const stageQ1 = document.getElementById('stageQ1');
    const stageFull = document.getElementById('stageFull');
    stageQ1.innerHTML = svgQ1;
    stageFull.innerHTML = svgFull;

    this.applyZoomToStages();
    this.bindStageInteractions(stageQ1.querySelector('svg'), scopeW, scopeH, false);
    this.bindStageInteractions(stageFull.querySelector('svg'), scopeW, scopeH, true);
  }

  applyZoomToStages() {
    const baseHeight = Math.round((window.innerHeight - 140) * this.zoomScale);
    for (const id of ['stageQ1', 'stageFull']) {
      const svg = document.querySelector(`#${id} svg`);
      if (svg) {
        svg.style.height = `${baseHeight}px`;
        svg.style.width = 'auto';
        svg.style.maxHeight = this.zoomScale > 1.0 ? 'none' : 'calc(100vh - 140px)';
        svg.style.maxWidth = this.zoomScale > 1.0 ? 'none' : '100%';
      }
    }
  }

  bindStageInteractions(svgEl, scopeW, scopeH, isFullMirror) {
    if (!svgEl) return;

    const clientToUU = (evt) => {
      const rect = svgEl.getBoundingClientRect();
      const nx = (evt.clientX - rect.left) / rect.width;
      const ny = (evt.clientY - rect.top) / rect.height;
      if (isFullMirror) {
        const ux = (nx * 2 - 1) * scopeW;
        const uy = (ny * 2 - 1) * scopeH;
        return { x: Math.round(ux), y: Math.round(uy), q1x: Math.round(Math.abs(ux)), q1y: Math.round(Math.abs(uy)) };
      } else {
        const ux = nx * scopeW;
        const uy = ny * scopeH;
        return { x: Math.round(ux), y: Math.round(uy), q1x: Math.round(ux), q1y: Math.round(uy) };
      }
    };

    svgEl.onmousemove = (evt) => {
      const pt = clientToUU(evt);
      document.getElementById('lblCursorCoord').textContent =
        `X: ${pt.x} UU, Y: ${pt.y} UU (Q1: ${pt.q1x}, ${pt.q1y})`;
    };

    svgEl.onclick = (evt) => {
      const pt = clientToUU(evt);
      const layer = this.getSelectedLayer();
      if (!layer || !this.pickTarget) return;

      if (this.pickTarget === 'center' && layer.type === 'circle_arc') {
        layer.cx = pt.q1x;
        layer.cy = pt.q1y;
        this.pickTarget = null;
      } else if (layer.type === 'three_point_arc') {
        if (this.pickTarget === 'p1') {
          layer.x1 = pt.q1x;
          layer.y1 = pt.q1y;
          this.pickTarget = 'p2';
        } else if (this.pickTarget === 'p2') {
          layer.x2 = pt.q1x;
          layer.y2 = pt.q1y;
          this.pickTarget = 'p3';
        } else if (this.pickTarget === 'p3') {
          layer.x3 = pt.q1x;
          layer.y3 = pt.q1y;
          this.pickTarget = null;
        }
      }

      this.renderInspector();
      this.saveAndRenderCanvas();
    };
  }

  setupDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) this.handleImportedFile(file);
    });
  }

  handleImportedFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed && Array.isArray(parsed.layers)) {
            this.project = {
              ...JSON.parse(JSON.stringify(DEFAULT_PROJECT)),
              ...parsed,
              shaderPreview: { ...DEFAULT_PROJECT.shaderPreview, ...(parsed.shaderPreview || {}) },
              referenceOverlays: { ...DEFAULT_PROJECT.referenceOverlays, ...(parsed.referenceOverlays || {}) }
            };
            this.selectedLayerId = this.project.layers[0]?.id || null;
            this.syncAll();
          }
        } catch (err) {
          alert(`JSON 解析失败: ${err.message}`);
        }
      } else if (file.name.toLowerCase().endsWith('.svg')) {
        this.project.referenceOverlays.customSvgContent = content;
        this.project.referenceOverlays.customSvgVisible = true;
        document.getElementById('customSvgRefRow').style.display = 'block';
        document.getElementById('chkRefCustomSvg').checked = true;
        this.saveAndRenderCanvas();
      }
    };
    reader.readAsText(file);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GroundStudioApp();
});
