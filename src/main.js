import { DEFAULT_PROJECT, DEFAULT_GRAY_PALETTE_LEVELS, createNewLayerTemplate } from './defaultProject.js';
import { Q1_NAMED_ANCHORS, ALL_HITBOX_UNION_BOUNDS } from './physicsData.js';
import {
  solveThreePointArc,
  solveMonotoneFivePointSpline,
  trimLineSegment,
  findNearestAnchor,
  distanceToLayerQ1,
  resolveLayerGrayAndCss
} from './geometryMath.js';
import { buildArenaSvgString, getScopeDimensions } from './svgRenderer.js';
import {
  EXPORT_PRESETS,
  resolvePresetDimensions,
  autoDistributePaletteGrayLevels,
  computePaletteIntervals,
  buildTextureManifest,
  exportManifestJson,
  exportProjectJson,
  exportSvgFile,
  exportRasterTexture
} from './exporter.js';

const STORAGE_KEY = 'rl_standard_ground_project_v6';

class GroundStudioApp {
  constructor() {
    this.project = this.loadSavedProject();
    this.selectedLayerId = this.project.layers[3]?.id || this.project.layers[0]?.id || null;
    this.hoveredLayerId = null;
    this.snappedAnchor = null;
    this.magneticSnapEnabled = true;
    this.viewMode = 'split'; // 'split' (Q1 + Full) | 'full_only' | 'q1_only'
    this.zoomScale = 1.0;
    this.pickTarget = null; // null | 'p1' | 'p2' | 'p3' | 'center' | 'seg_p1' | 'seg_p2'
    this.selectedExportPresetId = EXPORT_PRESETS[1]?.id || EXPORT_PRESETS[0].id; // Default to Q1 2048x3000 proportional
    this.exportFormat = 'image/webp';
    this.exportWithRef = false;

    this.root = document.getElementById('app');
    this.renderShell();
    this.syncAll();
    this.setupDragAndDrop();
  }

  ensurePaletteLevels(proj) {
    if (!proj.colorPalettePreview || !Array.isArray(proj.colorPalettePreview.levels) || proj.colorPalettePreview.levels.length < 2) {
      proj.colorPalettePreview = {
        enabled: proj.colorPalettePreview?.enabled ?? true,
        levels: DEFAULT_GRAY_PALETTE_LEVELS.map(l => ({ ...l }))
      };
    }
    const maxLvl = proj.colorPalettePreview.levels.length - 1;
    // Ensure each layer has a valid grayLevel (1..maxLvl)
    if (Array.isArray(proj.layers)) {
      proj.layers.forEach((layer, idx) => {
        if (layer.grayLevel === undefined || layer.grayLevel === null) {
          layer.grayLevel = (idx % maxLvl) + 1;
        } else if (layer.grayLevel > maxLvl) {
          layer.grayLevel = maxLvl;
        }
        const lvlObj = proj.colorPalettePreview.levels.find(l => l.level === Number(layer.grayLevel));
        if (lvlObj && layer.grayLevel >= 1 && layer.grayLevel <= maxLvl) {
          layer.gray = lvlObj.gray;
        }
      });
    }
    return proj;
  }

  loadSavedProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.layers)) {
          return this.ensurePaletteLevels({
            ...JSON.parse(JSON.stringify(DEFAULT_PROJECT)),
            ...parsed,
            colorPalettePreview: {
              ...JSON.parse(JSON.stringify(DEFAULT_PROJECT.colorPalettePreview)),
              ...(parsed.colorPalettePreview || {})
            },
            shaderPreview: { ...DEFAULT_PROJECT.shaderPreview, ...(parsed.shaderPreview || {}) },
            referenceOverlays: { ...DEFAULT_PROJECT.referenceOverlays, ...(parsed.referenceOverlays || {}) }
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load saved project from localStorage:', e);
    }
    return this.ensurePaletteLevels(JSON.parse(JSON.stringify(DEFAULT_PROJECT)));
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

  copySingleLayerJson(layer, btnEl = null) {
    if (!layer) return;
    const jsonStr = JSON.stringify(layer, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '✅ 已复制本层!';
        setTimeout(() => { btnEl.innerHTML = orig; }, 1400);
      }
    }).catch(() => {
      const ta = document.getElementById('txtSingleLayerJson');
      if (ta) {
        ta.style.display = 'block';
        ta.value = jsonStr;
        ta.select();
        document.execCommand('copy');
      }
    });
  }

  renderShell() {
    const safeExp = this.project.smallPadSafeExpand ?? 60;
    const totalLvls = this.project.colorPalettePreview?.levels?.length || 7;
    const maxLineLvl = totalLvls - 1;
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
          <label class="checkbox-row" style="background:rgba(16,185,129,0.15);padding:4px 9px;border-radius:6px;border:1px solid #10b981">
            <input type="checkbox" id="chkColorPalettePreview" />
            <span>🌈 分层彩色预览 (L0地面 + L1~L${maxLineLvl}高对比度层)</span>
          </label>
          <label class="checkbox-row" style="background:#1e293b;padding:4px 9px;border-radius:6px;border:1px solid #334155">
            <input type="checkbox" id="chkShaderSim" />
            <span>🎨 游戏双色 Shader 预览</span>
          </label>
        </div>

        <div class="toolbar-group">
          <button class="btn" id="btnUploadFile" title="导入 JSON 参数文件或参考 SVG">📂 导入 JSON / SVG</button>
          <input type="file" id="fileInputHidden" accept=".json,.svg" style="display:none" />
          <button class="btn" id="btnExportJson" title="保存当前所有图层参数为 JSON">💾 导出整套 JSON</button>
          <button class="btn btn-danger" id="btnResetDefault" title="恢复默认预设">↺ 重置默认</button>
        </div>
      </header>

      <!-- Main 3-Column Workspace -->
      <div class="workspace">
        <!-- Left Sidebar: 1. Actual Drawn Layer Stack, 2. High-Contrast Palette, 3. Small Pad Safe Area, 4. Reference Guides & Canvas -->
        <aside class="sidebar">
          <!-- 1. Parametric Layer Stack (What is ACTUALLY drawn on the texture!) -->
          <div class="panel-section">
            <div class="panel-title">
              <span>1. ✏️ 实际绘制的贴图图层 (${this.project.layers.length} 层)</span>
            </div>
            <div class="hint-box">
              已精简整合为 <b>L0 地面基底 + L1~L${maxLineLvl} 共 ${totalLvls} 个有效层级</b>（相邻灰度跨度高达 <b>42.5</b>，WebP 导出后极易区分）。每层可直接切换所属层级或勾选显隐。
            </div>
            <div class="field-inline">
              <select id="selNewLayerType" style="flex:1">
                <option value="rect_or_line">+ 锚点吸附直线/虚线 (含首尾跳过)</option>
                <option value="monotone_pad_spline">+ 五点斜率单调橄榄球曲线</option>
                <option value="spawn_marker_group">+ 车辆生成点全碰撞箱四角框</option>
                <option value="circle_arc">+ 定点圆 / 极角圆弧 (含首尾跳过)</option>
                <option value="three_point_arc">+ 三点确定圆弧 (3-Point Arc)</option>
                <option value="contour_offset">+ 沿地面边界内缩线 (Inset Path)</option>
                <option value="boost_pad_group">+ Boost Pad 判定内收环 (Pad Rings)</option>
                <option value="turf_stripes">+ 草坪深浅条纹 (Turf Stripes)</option>
              </select>
              <button class="btn btn-primary" id="btnAddLayer">添加</button>
            </div>
            <div class="layer-list" id="layerListContainer"></div>
          </div>

          <!-- 2. High-Contrast Grayscale & Interval Classification Config -->
          <div class="panel-section">
            <div class="panel-title" style="flex-wrap:wrap;gap:4px">
              <span id="lblPalettePanelTitle">2. 🌈 灰度层级与区间分类 (${totalLvls}级)</span>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-emerald" id="btnAddPaletteLevel" style="padding:2px 6px;font-size:10px" title="新增一个灰度分类层级，并自动按最大区分度重排 0~255 中心值">➕ 新增层级</button>
                <button class="btn btn-primary" id="btnAutoDistributeGray" style="padding:2px 6px;font-size:10px" title="将当前所有层级在 0~255 之间自动均分，使相邻灰度间隔最大化（抗 WebP 压缩损失）">⚡ 最大区分度均分</button>
                <button class="btn" id="btnResetPalette" style="padding:2px 6px;font-size:10px" title="恢复默认 7 级高对比等分灰度 (0, 42, 85, 128, 170, 212, 255)">↺ 默认7级</button>
              </div>
            </div>
            <div class="hint-box" id="lblPaletteSummaryHint" style="border-left-color:#10b981">
              自动按层级数量均分 <code>0~255</code> 灰度中心值并计算无重叠判定区间 <code>[Min~Max]</code>，最大化抵抗 WebP 有损压缩偏移。
            </div>
            <div id="paletteLevelsContainer" style="display:flex;flex-direction:column;gap:5px"></div>
          </div>

          <!-- 3. Global Small Boost Pad Safe Area Config -->
          <div class="panel-section">
            <div class="panel-title">
              <span>3. 🛡️ Small Boost Pad Safe Area (截断保护区)</span>
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
              <span>🩷 在画布上显示 Safe Area 虚线边界</span>
            </label>
          </div>

          <!-- 4. Physical Reference Overlays (Non-Exported Guides) -->
          <div class="panel-section">
            <div class="panel-title">
              <span>4. 📐 物理判定参考层 (仅对位，不导出)</span>
            </div>
            <label class="checkbox-row"><input type="checkbox" id="chkRefPadNumbers" /> <span>🔢 显示 Boost Pad 与车位编号 (#B1~#S9, #KO1~#DM2, #IX1)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefFlatFloor" /> <span>🟢 Z=0 纯平地面边界 (绿色虚线)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefBoostPads" /> <span>🟡 Boost Pad 拾取判定圆 (R=208 / 144)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefSpawns" /> <span>🔴 显示全部7种车型碰撞箱叠加参考框</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefGoalBox" /> <span>🟠 球门框与进球判定线 (Y=5120~6000)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefOuterWall" /> <span>🔵 4096 垂直外墙轮廓 (浅蓝实线)</span></label>
            <label class="checkbox-row"><input type="checkbox" id="chkRefGrid" /> <span>📏 512 / 1024 UU 坐标网格</span></label>
            <div id="customSvgRefRow" style="display:none;border-top:1px dashed #334155;padding-top:6px">
              <label class="checkbox-row"><input type="checkbox" id="chkRefCustomSvg" /> <span>🖼️ 显示导入的外部参考 SVG</span></label>
            </div>
          </div>

          <!-- 5. Canvas Scope & Base Grayscale -->
          <div class="panel-section">
            <div class="panel-title">
              <span>5. 画布范围与基底设置</span>
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
                <span>背景基底灰度 (L0 Ground Gray)</span>
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
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span id="lblScopeInfo">画布: 4096 × 6000 UU</span>
              <span class="coord-readout" id="lblCursorCoord">X: 0 UU, Y: 0 UU</span>
              <span id="lblHoverLayer" style="font-size:11px;color:#38bdf8;font-family:monospace"></span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <label class="checkbox-row" style="font-size:11px;color:#6ee7b7" title="在画布拾取坐标时自动吸附到最近的 Boost Pad / 车位锚点">
                <input type="checkbox" id="chkMagneticSnap" checked />
                <span>🧲 锚点磁吸</span>
              </label>
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
              <div class="pane-badge">✏️ 四分之一编辑区 (Q1) — 悬停高亮线条，点击直接选中线条或磁吸拾取锚点</div>
              <div class="svg-stage" id="stageQ1"></div>
            </div>
            <!-- Right Pane: Full 4x Mirrored Arena Preview -->
            <div class="canvas-pane" id="paneFull">
              <div class="pane-badge">🔍 完整球场实时 2 次镜像预览 (8192 × 12000 UU)</div>
              <div class="svg-stage" id="stageFull"></div>
            </div>
          </div>
        </main>

        <!-- Right Sidebar: Selected Layer Inspector & Multi-Spec Texture + Manifest Exporter -->
        <aside class="sidebar-right">
          <!-- Selected Layer Inspector -->
          <div class="panel-section" id="inspectorPanel">
            <div class="panel-title" style="flex-wrap:wrap;gap:6px">
              <span>🛠️ 当前选中图层参数</span>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-primary" id="btnCopyLayerJson" style="padding:2px 8px;font-size:11px" title="仅复制当前选中图层的 JSON 参数，方便直接发给助手沟通">📋 复制本层参数</button>
                <button class="btn" id="btnToggleLayerJsonBox" style="padding:2px 7px;font-size:11px" title="查看或粘贴单层 JSON">{ } 粘贴/编辑JSON</button>
                <button class="btn" id="btnDuplicateLayer" style="padding:2px 7px;font-size:11px">复制图层</button>
                <button class="btn btn-danger" id="btnDeleteLayer" style="padding:2px 7px;font-size:11px">删除</button>
              </div>
            </div>
            <div id="singleLayerJsonBox" style="display:none;background:#090d16;border:1px solid #334155;border-radius:6px;padding:8px">
              <div class="field-label" style="margin-bottom:4px">
                <span>单图层 JSON (可直接修改或粘贴后点击「应用到本层」)</span>
              </div>
              <textarea id="txtSingleLayerJson" rows="7" style="width:100%;background:#0f172a;color:#93c5fd;border:1px solid #334155;border-radius:4px;font-family:monospace;font-size:11px;padding:6px"></textarea>
              <div style="display:flex;gap:6px;margin-top:6px">
                <button class="btn btn-emerald" id="btnApplySingleLayerJson" style="flex:1;justify-content:center;padding:4px">✅ 应用 JSON 到当前图层</button>
                <button class="btn" id="btnAddFromLayerJson" style="flex:1;justify-content:center;padding:4px">➕ 作为新图层插入</button>
              </div>
            </div>
            <div id="inspectorBody"></div>
          </div>

          <!-- Export Panel -->
          <div class="panel-section">
            <div class="panel-title">
              <span>🚀 导出 WebP 贴图 & Manifest 规范</span>
            </div>
            <div class="field-row">
              <div class="field-label"><span>常用导出规格预设</span></div>
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
            <label class="checkbox-row" style="color:#6ee7b7">
              <input type="checkbox" id="chkExportColorMode" />
              <span>🌈 导出彩色预览图 (不勾选则导出标准灰度贴图)</span>
            </label>
            <div style="display:flex;flex-direction:column;gap:7px;margin-top:4px">
              <button class="btn btn-emerald" id="btnExportRaster" style="justify-content:center;padding:9px;font-size:13px;font-weight:700">
                🖼️ 导出光栅贴图 (WebP / PNG)
              </button>
              <div style="display:flex;gap:6px">
                <button class="btn btn-primary" id="btnExportManifest" style="flex:1;justify-content:center;padding:8px;font-size:12px;font-weight:700" title="导出包含物理空间尺寸、UV映射公式与各层级灰度中心值/判定区间 [Min~Max] 的 manifest.json">
                  📋 导出 Manifest.json (灰度区间 + 物理空间)
                </button>
                <button class="btn" id="btnToggleManifestPreview" style="padding:8px 10px;font-size:12px" title="在线预览或复制生成的 Manifest JSON">
                  👁️ 预览
                </button>
              </div>
              <div id="manifestPreviewBox" style="display:none;background:#090d16;border:1px solid #334155;border-radius:6px;padding:8px;margin-top:2px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <span style="font-size:11px;color:#93c5fd;font-weight:600">📄 Manifest.json (物理空间映射 + 灰度分类区间)</span>
                  <button class="btn btn-primary" id="btnCopyManifestJson" style="padding:2px 8px;font-size:10px">📋 复制 JSON</button>
                </div>
                <textarea id="txtManifestPreview" readonly rows="10" style="width:100%;background:#0f172a;color:#a7f3d0;border:1px solid #334155;border-radius:4px;font-family:monospace;font-size:10px;padding:6px"></textarea>
              </div>
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

    document.getElementById('chkMagneticSnap').onchange = (e) => {
      this.magneticSnapEnabled = e.target.checked;
    };

    // 10-Level Color Palette Preview Toggle
    const chkPalette = document.getElementById('chkColorPalettePreview');
    chkPalette.checked = Boolean(this.project.colorPalettePreview?.enabled);
    chkPalette.onchange = (e) => {
      if (!this.project.colorPalettePreview) {
        this.project.colorPalettePreview = { enabled: true, levels: DEFAULT_GRAY_PALETTE_LEVELS.map(l => ({ ...l })) };
      }
      this.project.colorPalettePreview.enabled = e.target.checked;
      if (e.target.checked && this.project.shaderPreview.enabled) {
        this.project.shaderPreview.enabled = false;
        document.getElementById('chkShaderSim').checked = false;
        document.getElementById('shaderControlsBox').style.display = 'none';
      }
      this.renderLayerList();
      this.renderInspector();
      this.saveAndRenderCanvas();
    };

    const syncLayerGraysFromPalette = () => {
      const levels = this.project.colorPalettePreview?.levels || [];
      if (levels[0]) {
        this.project.backgroundGray = levels[0].gray;
        const rngBg = document.getElementById('rngBgGray');
        const valBg = document.getElementById('valBgGray');
        if (rngBg) rngBg.value = levels[0].gray;
        if (valBg) valBg.textContent = levels[0].gray;
      }
      const maxLvl = Math.max(1, levels.length - 1);
      this.project.layers.forEach((layer) => {
        if (layer.grayLevel > maxLvl) layer.grayLevel = maxLvl;
        const lvl = levels.find(x => x.level === Number(layer.grayLevel));
        if (lvl) layer.gray = lvl.gray;
      });
    };

    document.getElementById('btnAddPaletteLevel').onclick = () => {
      this.ensurePaletteLevels(this.project);
      const levels = this.project.colorPalettePreview.levels;
      const newLevelIdx = levels.length;
      const extraColors = ['#a855f7', '#fb923c', '#2dd4bf', '#f87171', '#60a5fa', '#f472b6', '#a3e635', '#fbbf24'];
      const pickColor = extraColors[(newLevelIdx - 1) % extraColors.length];
      levels.push({
        level: newLevelIdx,
        name: `L${newLevelIdx} 自定义分类层级 ${newLevelIdx}`,
        gray: 255,
        color: pickColor
      });
      autoDistributePaletteGrayLevels(levels);
      syncLayerGraysFromPalette();
      this.syncAll();
    };

    document.getElementById('btnAutoDistributeGray').onclick = () => {
      this.ensurePaletteLevels(this.project);
      autoDistributePaletteGrayLevels(this.project.colorPalettePreview.levels);
      syncLayerGraysFromPalette();
      this.syncAll();
    };

    document.getElementById('btnResetPalette').onclick = () => {
      this.project.colorPalettePreview = {
        enabled: true,
        levels: DEFAULT_GRAY_PALETTE_LEVELS.map(l => ({ ...l }))
      };
      chkPalette.checked = true;
      syncLayerGraysFromPalette();
      this.syncAll();
    };

    // Single Layer JSON Copy & Paste
    const btnCopyLayer = document.getElementById('btnCopyLayerJson');
    btnCopyLayer.onclick = () => {
      this.copySingleLayerJson(this.getSelectedLayer(), btnCopyLayer);
    };

    const jsonBox = document.getElementById('singleLayerJsonBox');
    const txtJson = document.getElementById('txtSingleLayerJson');
    document.getElementById('btnToggleLayerJsonBox').onclick = () => {
      const isHidden = jsonBox.style.display === 'none';
      jsonBox.style.display = isHidden ? 'block' : 'none';
      if (isHidden && this.getSelectedLayer()) {
        txtJson.value = JSON.stringify(this.getSelectedLayer(), null, 2);
      }
    };

    document.getElementById('btnApplySingleLayerJson').onclick = () => {
      try {
        const parsed = JSON.parse(txtJson.value);
        const idx = this.project.layers.findIndex(l => l.id === this.selectedLayerId);
        if (idx >= 0 && parsed && parsed.type) {
          this.project.layers[idx] = { ...this.project.layers[idx], ...parsed, id: this.selectedLayerId };
          this.syncAll();
        }
      } catch (err) {
        alert(`单层 JSON 格式有误: ${err.message}`);
      }
    };

    document.getElementById('btnAddFromLayerJson').onclick = () => {
      try {
        const parsed = JSON.parse(txtJson.value);
        if (parsed && parsed.type) {
          parsed.id = `layer_${parsed.type}_${Date.now()}`;
          const maxLvl = (this.project.colorPalettePreview?.levels?.length || 7) - 1;
          if (parsed.grayLevel === undefined || parsed.grayLevel > maxLvl) parsed.grayLevel = maxLvl;
          this.project.layers.push(parsed);
          this.selectedLayerId = parsed.id;
          this.syncAll();
        }
      } catch (err) {
        alert(`单层 JSON 格式有误: ${err.message}`);
      }
    };

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
      this.refreshManifestPreviewIfOpen();
      this.saveAndRenderCanvas();
    };
    rngSafe.oninput = (e) => updateSafeExpand(e.target.value);
    numSafe.oninput = (e) => updateSafeExpand(e.target.value);

    // Shader sim toggle
    const chkShader = document.getElementById('chkShaderSim');
    chkShader.checked = Boolean(this.project.shaderPreview.enabled);
    chkShader.onchange = (e) => {
      this.project.shaderPreview.enabled = e.target.checked;
      if (e.target.checked && this.project.colorPalettePreview) {
        this.project.colorPalettePreview.enabled = false;
        chkPalette.checked = false;
      }
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
      this.refreshManifestPreviewIfOpen();
      this.saveAndRenderCanvas();
    };

    const rngBg = document.getElementById('rngBgGray');
    rngBg.value = this.project.backgroundGray ?? 0;
    document.getElementById('valBgGray').textContent = rngBg.value;
    rngBg.oninput = (e) => {
      const gVal = parseInt(e.target.value, 10) || 0;
      this.project.backgroundGray = gVal;
      if (this.project.colorPalettePreview?.levels?.[0]) {
        this.project.colorPalettePreview.levels[0].gray = gVal;
      }
      document.getElementById('valBgGray').textContent = gVal;
      this.renderPaletteLevels();
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
    bindRefCheck('chkRefPadNumbers', 'showPadNumbers');
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
      const lvlObj = this.project.colorPalettePreview?.levels?.find(l => l.level === Number(newLayer.grayLevel));
      if (lvlObj) newLayer.gray = lvlObj.gray;
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
      this.project = this.ensurePaletteLevels(JSON.parse(JSON.stringify(DEFAULT_PROJECT)));
      this.selectedLayerId = this.project.layers[0]?.id || null;
      const safeVal = this.project.smallPadSafeExpand ?? 60;
      document.getElementById('rngSafeExpand').value = safeVal;
      document.getElementById('numSafeExpand').value = safeVal;
      document.getElementById('valSafeExpand').textContent = `+${safeVal} UU (总 R=${144 + safeVal})`;
      document.getElementById('chkColorPalettePreview').checked = Boolean(this.project.colorPalettePreview?.enabled);
      this.syncAll();
    };

    // Export Presets
    const selPreset = document.getElementById('selExportPreset');
    selPreset.onchange = (e) => {
      this.selectedExportPresetId = e.target.value;
      this.syncExportPresetInputs();
      this.refreshManifestPreviewIfOpen();
    };

    document.getElementById('inpExportW').oninput = () => this.refreshManifestPreviewIfOpen();
    document.getElementById('inpExportH').oninput = () => this.refreshManifestPreviewIfOpen();
    document.getElementById('selExportMode').onchange = () => this.refreshManifestPreviewIfOpen();

    document.getElementById('btnExportRaster').onclick = () => {
      const w = parseInt(document.getElementById('inpExportW').value, 10) || 2048;
      const h = parseInt(document.getElementById('inpExportH').value, 10) || 3000;
      const mode = document.getElementById('selExportMode').value;
      const format = document.getElementById('selExportFormat').value;
      const includeReference = document.getElementById('chkExportWithRef').checked;
      const useColorPalettePreview = document.getElementById('chkExportColorMode').checked;
      exportRasterTexture(this.project, {
        mode,
        width: w,
        height: h,
        format,
        useShaderPreview: Boolean(this.project.shaderPreview.enabled),
        useColorPalettePreview,
        includeReference
      });
    };

    document.getElementById('btnExportManifest').onclick = () => {
      const w = parseInt(document.getElementById('inpExportW').value, 10) || 2048;
      const h = parseInt(document.getElementById('inpExportH').value, 10) || 3000;
      const mode = document.getElementById('selExportMode').value;
      exportManifestJson(this.project, { mode, width: w, height: h });
    };

    const manifestBox = document.getElementById('manifestPreviewBox');
    document.getElementById('btnToggleManifestPreview').onclick = () => {
      const isHidden = manifestBox.style.display === 'none';
      manifestBox.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        this.refreshManifestPreviewIfOpen();
      }
    };

    const btnCopyManifest = document.getElementById('btnCopyManifestJson');
    btnCopyManifest.onclick = () => {
      const txtEl = document.getElementById('txtManifestPreview');
      if (!txtEl) return;
      this.refreshManifestPreviewIfOpen();
      navigator.clipboard.writeText(txtEl.value).then(() => {
        const orig = btnCopyManifest.innerHTML;
        btnCopyManifest.innerHTML = '✅ 已复制!';
        setTimeout(() => { btnCopyManifest.innerHTML = orig; }, 1400);
      });
    };

    document.getElementById('btnExportSvgQ1').onclick = () => {
      exportSvgFile(
        this.project,
        'q1',
        document.getElementById('chkExportWithRef').checked,
        document.getElementById('chkExportColorMode').checked
      );
    };
    document.getElementById('btnExportSvgFull').onclick = () => {
      exportSvgFile(
        this.project,
        'full_mirror',
        document.getElementById('chkExportWithRef').checked,
        document.getElementById('chkExportColorMode').checked
      );
    };

    this.syncExportPresetInputs();
  }

  refreshManifestPreviewIfOpen() {
    const manifestBox = document.getElementById('manifestPreviewBox');
    const txtEl = document.getElementById('txtManifestPreview');
    if (!manifestBox || !txtEl || manifestBox.style.display === 'none') return;
    const w = parseInt(document.getElementById('inpExportW')?.value, 10) || 2048;
    const h = parseInt(document.getElementById('inpExportH')?.value, 10) || 3000;
    const mode = document.getElementById('selExportMode')?.value || 'q1';
    const manifest = buildTextureManifest(this.project, { mode, width: w, height: h });
    txtEl.value = JSON.stringify(manifest, null, 2);
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
    this.renderPaletteLevels();
    this.renderLayerList();
    this.renderInspector();
    this.refreshManifestPreviewIfOpen();
    this.saveAndRenderCanvas();
  }

  renderPaletteLevels() {
    const container = document.getElementById('paletteLevelsContainer');
    if (!container) return;
    this.ensurePaletteLevels(this.project);
    const levels = this.project.colorPalettePreview.levels;
    const intervals = computePaletteIntervals(levels);
    const intervalMap = new Map(intervals.map(item => [item.level, item]));

    const n = intervals.length;
    const minStep = n > 1
      ? Math.min(...intervals.slice(1).map((l, idx) => l.gray - intervals[idx].gray))
      : 255;
    const halfMargin = Math.floor(minStep / 2);

    const titleEl = document.getElementById('lblPalettePanelTitle');
    if (titleEl) {
      titleEl.textContent = `2. 🌈 灰度层级与区间分类 (${n}级, ΔGray≥${minStep})`;
    }
    const summaryEl = document.getElementById('lblPaletteSummaryHint');
    if (summaryEl) {
      summaryEl.innerHTML = `当前共 <b>${n} 个层级 (L0~L${n - 1})</b>，相邻中心最小间距 <b>${minStep}</b>，WebP 压缩安全容差 <b>±${halfMargin}</b>。下方显示每个层级的<b>中心灰度</b>与自动计算的<b>无重叠判定区间 [Min~Max]</b>。`;
    }

    container.innerHTML = '';
    levels.forEach((lvlObj, idx) => {
      const iv = intervalMap.get(lvlObj.level) || {
        rangeMin: lvlObj.gray,
        rangeMax: lvlObj.gray,
        normMin: 0,
        normMax: 1,
        webpToleranceMinus: 0,
        webpTolerancePlus: 0
      };
      const boundCount = lvlObj.level === 0
        ? '地面'
        : `${this.project.layers.filter(l => Number(l.grayLevel) === lvlObj.level).length}层`;

      const canDelete = levels.length > 2 && lvlObj.level > 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:34px 1fr 46px 68px 26px 34px 20px;align-items:center;gap:4px;background:#0f172a;border:1px solid #334155;border-radius:5px;padding:4px 5px;font-size:11px';

      const grayHex = lvlObj.gray.toString(16).padStart(2, '0');
      const graySwatch = `#${grayHex}${grayHex}${grayHex}`;

      row.innerHTML = `
        <span style="font-family:monospace;font-weight:700;color:${lvlObj.color};display:flex;align-items:center;gap:3px">
          <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${graySwatch};border:1px solid #64748b" title="中心灰度 RGB(${lvlObj.gray},${lvlObj.gray},${lvlObj.gray})"></span>
          L${lvlObj.level}
        </span>
        <input type="text" class="inp-lvl-name" value="${lvlObj.name}" style="padding:2px 4px;font-size:11px;min-width:0" />
        <input type="number" class="inp-lvl-gray" value="${lvlObj.gray}" min="0" max="255" step="1" title="中心灰度值 (0..255)" style="padding:2px 3px;font-size:11px;text-align:right;font-family:monospace" />
        <span class="lvl-interval-badge" style="font-family:monospace;font-size:10px;color:#6ee7b7;background:#064e3b;border:1px solid #059669;border-radius:4px;padding:1px 3px;text-align:center" title="自动判定区间 [${iv.rangeMin}..${iv.rangeMax}] | 归一化 [${iv.normMin}..${iv.normMax}] | WebP容差 [-${iv.webpToleranceMinus}/+${iv.webpTolerancePlus}]">
          [${iv.rangeMin}~${iv.rangeMax}]
        </span>
        <input type="color" class="inp-lvl-color" value="${lvlObj.color}" title="该层级的预览颜色" style="width:24px;height:20px;padding:0" />
        <span style="font-family:monospace;font-size:10px;color:#94a3b8;text-align:right">${boundCount}</span>
        ${canDelete
          ? `<button class="icon-btn btn-del-lvl" title="删除 L${lvlObj.level} 并自动重排最大区分度灰度" style="padding:0 3px;font-size:11px;color:#f87171">×</button>`
          : `<span style="text-align:center;color:#475569;font-size:10px">-</span>`}
      `;

      row.querySelector('.inp-lvl-name').oninput = (e) => {
        lvlObj.name = e.target.value;
        this.renderInspector();
        this.refreshManifestPreviewIfOpen();
        this.saveProject();
      };

      row.querySelector('.inp-lvl-gray').onchange = (e) => {
        const g = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
        lvlObj.gray = g;
        if (lvlObj.level === 0) {
          this.project.backgroundGray = g;
          const rngBg = document.getElementById('rngBgGray');
          const valBg = document.getElementById('valBgGray');
          if (rngBg) rngBg.value = g;
          if (valBg) valBg.textContent = g;
        } else {
          this.project.layers.forEach((l) => {
            if (Number(l.grayLevel) === lvlObj.level) {
              l.gray = g;
            }
          });
        }
        this.renderPaletteLevels();
        this.renderInspector();
        this.refreshManifestPreviewIfOpen();
        this.saveAndRenderCanvas();
      };

      row.querySelector('.inp-lvl-color').oninput = (e) => {
        lvlObj.color = e.target.value;
        this.renderLayerList();
        this.renderInspector();
        this.refreshManifestPreviewIfOpen();
        this.saveAndRenderCanvas();
      };

      const delBtn = row.querySelector('.btn-del-lvl');
      if (delBtn) {
        delBtn.onclick = () => {
          const removedLevel = lvlObj.level;
          levels.splice(idx, 1);
          autoDistributePaletteGrayLevels(levels);
          const maxLvl = Math.max(1, levels.length - 1);
          this.project.layers.forEach((l) => {
            if (Number(l.grayLevel) >= removedLevel) {
              l.grayLevel = Math.max(1, Math.min(maxLvl, Number(l.grayLevel) - 1));
            }
            const found = levels.find(x => x.level === Number(l.grayLevel));
            if (found) l.gray = found.gray;
          });
          if (levels[0]) {
            this.project.backgroundGray = levels[0].gray;
          }
          this.syncAll();
        };
      }

      container.appendChild(row);
    });
  }

  renderLayerList() {
    const container = document.getElementById('layerListContainer');
    container.innerHTML = '';
    const levels = this.project.colorPalettePreview?.levels || DEFAULT_GRAY_PALETTE_LEVELS;

    this.project.layers.forEach((layer, idx) => {
      const div = document.createElement('div');
      div.className = `layer-item ${layer.id === this.selectedLayerId ? 'selected' : ''}`;

      const badgeMap = {
        contour_offset: '边界线',
        circle_arc: '圆/弧',
        three_point_arc: '三点弧',
        monotone_pad_spline: '单调弧',
        rect_or_line: '框/线',
        boost_pad_group: '垫子环',
        spawn_marker_group: '生成点',
        turf_stripes: '条纹'
      };

      const maxLvl = levels.length - 1;
      const curLvl = Math.min(maxLvl, Math.max(1, Number(layer.grayLevel ?? maxLvl)));
      const lvlObj = levels.find(l => l.level === curLvl) || levels[maxLvl];
      const swatchColor = lvlObj ? lvlObj.color : '#ffffff';

      div.innerHTML = `
        <div class="layer-left">
          <input type="checkbox" class="layer-vis-chk" ${layer.visible ? 'checked' : ''} title="显示/隐藏该图层" />
          <span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${swatchColor};border:1px solid rgba(255,255,255,0.45);flex-shrink:0" title="当前绑定层级 L${curLvl} (Gray=${lvlObj?.gray ?? layer.gray})"></span>
          <select class="layer-lvl-select" title="快速切换该图层绑定的灰度/颜色层级 (L1~L${maxLvl})" style="width:52px;padding:1px 3px;font-size:10px;font-family:monospace;background:#0b1120;color:${swatchColor};border:1px solid #334155;border-radius:4px;flex-shrink:0">
            ${levels.filter(l => l.level >= 1).map(l => `<option value="${l.level}" ${l.level === curLvl ? 'selected' : ''}>L${l.level}</option>`).join('')}
          </select>
          <span class="layer-type-badge">${badgeMap[layer.type] || layer.type}</span>
          <span class="layer-name" title="${layer.name}" style="${layer.visible ? '' : 'opacity:0.45;text-decoration:line-through'}">${layer.name}</span>
        </div>
        <div class="layer-actions">
          <button class="icon-btn btn-copy-item" title="复制本层 JSON 参数">📋</button>
          <button class="icon-btn btn-up" title="上移">▲</button>
          <button class="icon-btn btn-down" title="下移">▼</button>
        </div>
      `;

      div.onmouseenter = () => {
        if (this.hoveredLayerId !== layer.id) {
          this.hoveredLayerId = layer.id;
          this.saveAndRenderCanvas();
        }
      };
      div.onmouseleave = () => {
        if (this.hoveredLayerId === layer.id) {
          this.hoveredLayerId = null;
          this.saveAndRenderCanvas();
        }
      };

      div.onclick = (e) => {
        if (
          e.target.classList.contains('layer-vis-chk') ||
          e.target.classList.contains('layer-lvl-select') ||
          e.target.classList.contains('icon-btn')
        ) return;
        this.selectedLayerId = layer.id;
        this.pickTarget = null;
        this.renderLayerList();
        this.renderInspector();
        this.saveAndRenderCanvas();
      };

      const selLvl = div.querySelector('.layer-lvl-select');
      selLvl.onchange = (e) => {
        e.stopPropagation();
        const newLvl = parseInt(e.target.value, 10) || 1;
        layer.grayLevel = newLvl;
        const found = levels.find(l => l.level === newLvl);
        if (found) layer.gray = found.gray;
        this.renderPaletteLevels();
        this.renderLayerList();
        if (this.selectedLayerId === layer.id) this.renderInspector();
        this.saveAndRenderCanvas();
      };

      const chk = div.querySelector('.layer-vis-chk');
      chk.onchange = (e) => {
        layer.visible = e.target.checked;
        this.renderLayerList();
        this.saveAndRenderCanvas();
      };

      const btnCopyItem = div.querySelector('.btn-copy-item');
      btnCopyItem.onclick = (e) => {
        e.stopPropagation();
        this.copySingleLayerJson(layer, btnCopyItem);
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

    const txtJson = document.getElementById('txtSingleLayerJson');
    if (txtJson && document.getElementById('singleLayerJsonBox')?.style.display !== 'none') {
      txtJson.value = JSON.stringify(layer, null, 2);
    }

    const levels = this.project.colorPalettePreview?.levels || DEFAULT_GRAY_PALETTE_LEVELS;
    const maxLvl = levels.length - 1;
    const curLvl = Math.min(maxLvl, Math.max(1, Number(layer.grayLevel ?? maxLvl)));
    const curLvlObj = levels.find(l => l.level === curLvl) || levels[maxLvl];

    let html = `
      <div class="field-row">
        <div class="field-label"><span>图层名称</span></div>
        <input type="text" id="inspName" value="${layer.name}" />
      </div>

      <!-- High-Contrast Grayscale & Color Palette Binding Selector -->
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.4);padding:8px;border-radius:6px;display:flex;flex-direction:column;gap:6px">
        <div class="field-label" style="color:#6ee7b7;font-weight:700">
          <span>🎨 绑定灰度与颜色层级 (L1~L${maxLvl}, 连同 L0 地面共 ${levels.length} 级)</span>
          <span style="font-family:monospace;color:${curLvlObj.color}">L${curLvl} · Gray ${curLvlObj.gray}</span>
        </div>
        <div class="field-inline">
          <span style="display:inline-block;width:22px;height:22px;border-radius:4px;background:${curLvlObj.color};border:1px solid #fff;flex-shrink:0" title="当前层级预览色 ${curLvlObj.color}"></span>
          <select id="selInspGrayLevel" style="flex:1">
            ${levels.filter(l => l.level >= 1).map(l => `<option value="${l.level}" ${l.level === curLvl ? 'selected' : ''}>L${l.level} — ${l.name} (Gray=${l.gray})</option>`).join('')}
          </select>
          <input type="color" id="colInspLevelColor" value="${curLvlObj.color}" title="直接修改当前绑定层级 L${curLvl} 的预览颜色" style="width:32px;height:26px" />
        </div>
        <div style="display:grid;grid-template-columns:repeat(${maxLvl}, 1fr);gap:4px">
          ${levels.filter(l => l.level >= 1).map(l => `
            <button class="btn-quick-lvl" data-lvl="${l.level}" title="点击绑定到 L${l.level} (${l.name}, Gray=${l.gray})" style="background:${l.level === curLvl ? l.color : '#0f172a'};color:${l.level === curLvl ? '#000' : l.color};border:1px solid ${l.color};border-radius:4px;padding:3px 0;font-size:10px;font-family:monospace;font-weight:700;cursor:pointer">
              L${l.level}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Safe Area Truncation Toggle (applicable to all line/arc/contour/spline/rect layers)
    if (layer.type !== 'boost_pad_group' && layer.type !== 'turf_stripes') {
      html += `
        <label class="checkbox-row" style="background:rgba(236,72,153,0.12);border:1px solid rgba(244,114,182,0.4);padding:6px 8px;border-radius:6px">
          <input type="checkbox" id="chkCutBySafeArea" ${layer.cutBySmallPadSafeArea ? 'checked' : ''} />
          <span>✂️ 被 Small Boost Pad Safe Area 截断 (进入保护区不画线)</span>
        </label>
      `;
    }

    // Start / End Distance Trimming (跳过起始距离 / 跳过终止距离) for lines and curves
    if (['rect_or_line', 'circle_arc', 'three_point_arc', 'monotone_pad_spline', 'contour_offset'].includes(layer.type)) {
      const tStart = layer.trimStart ?? 0;
      const tEnd = layer.trimEnd ?? 0;
      html += `
        <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.35);padding:8px;border-radius:6px;display:flex;flex-direction:column;gap:6px">
          <div class="field-label" style="color:#93c5fd;font-weight:600">
            <span>⏭️ 沿线首尾跳过距离 (Start / End Skip UU)</span>
          </div>
          <div class="field-grid-2">
            <div class="field-row">
              <div class="field-label"><span>起始跳过 (Trim Start UU)</span></div>
              <input type="number" id="numTrimStart" value="${tStart}" min="0" max="5000" step="10" />
            </div>
            <div class="field-row">
              <div class="field-label"><span>终止跳过 (Trim End UU)</span></div>
              <input type="number" id="numTrimEnd" value="${tEnd}" min="0" max="5000" step="10" />
            </div>
          </div>
        </div>
      `;
    }

    if (layer.type === 'contour_offset') {
      html += `
        <div class="field-row">
          <div class="field-label"><span>基准轮廓线 (Base Contour)</span></div>
          <select id="inspBaseContour">
            <option value="driftwoods_ground_mesh" ${layer.baseContour === 'driftwoods_ground_mesh' ? 'selected' : ''}>💠 场地3D地面模型含球门边界 (Driftwoods Ground Mesh, Y=4928)</option>
            <option value="driftwoods_pitch_mesh" ${layer.baseContour === 'driftwoods_pitch_mesh' ? 'selected' : ''}>💠 场地3D地面模型主场地边界 (球门线处闭合, Y=4928)</option>
            <option value="full_flat_floor" ${layer.baseContour === 'full_flat_floor' ? 'selected' : ''}>🟢 物理引擎 Z=0 纯平含球门边界 (CMF Physics, Y=4964.95)</option>
            <option value="pitch_flat_floor" ${layer.baseContour === 'pitch_flat_floor' ? 'selected' : ''}>🟢 物理引擎 Z=0 纯平主场地边界 (球门线处闭合)</option>
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
    } else if (layer.type === 'monotone_pad_spline') {
      const solved = solveMonotoneFivePointSpline(layer);
      const midExp = layer.midXExpand ?? 112;
      html += `
        <div class="hint-box">
          🏈 <b>五点斜率单调橄榄球曲线原理</b>：<br/>
          1. 四垫交点 <b>#IX1 (2048, 0)</b> 由 <b>#S1(1024,0)—#B1(3584,0)</b> 与右侧上下对称的 <b>#S3(2048,±1036)</b> 交叉得出。<br/>
          2. 起点 <b>P1(${2048 + midExp}, 0)</b> 从 #IX1 向外微移 <b>+${midExp} UU</b>，在穿过中场线 <code>Y=0</code> 处强制切线斜率 <b>dX/dY = 0 (竖直平滑过中线)</b>，再单调光滑穿过 <b>#S3 → #S4 → #S7 → #S9</b>。<br/>
          3. 当外扩在 <code>1 ~ 213 UU</code> 之间时，整条曲线斜率严格单调无拐点！
        </div>
        <div class="field-row">
          <div class="field-label">
            <span>P1 中场交点 (#IX1=2048) 向外偏移 (UU)</span>
            <span class="field-val" id="lblMidExpand">+${midExp} UU (X=${2048 + midExp})</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngMidExpand" min="2" max="450" step="2" value="${midExp}" />
            <input type="number" id="numMidExpand" value="${midExp}" style="width:78px" />
          </div>
        </div>
        <div class="field-grid-2">
          <div class="field-row">
            <div class="field-label"><span>切线饱满张力 (Tension)</span></div>
            <input type="number" id="numSplineTension" value="${layer.tension ?? 0.55}" min="0.15" max="0.95" step="0.05" />
          </div>
          <div class="field-row">
            <div class="field-label"><span>门前 #S9(X=0) 末端形态</span></div>
            <select id="selEndSlopeMode">
              <option value="natural_pointed" ${layer.endSlopeMode !== 'flat_x0' ? 'selected' : ''}>橄榄球自然尖端 (单调斜率)</option>
              <option value="flat_x0" ${layer.endSlopeMode === 'flat_x0' ? 'selected' : ''}>X=0 处水平切线收口</option>
            </select>
          </div>
        </div>
        <div style="font-size:11px;color:#94a3b8;font-family:monospace;background:#090d16;padding:6px;border-radius:5px">
          各段割线斜率 -dX/dY: ${solved.secantSlopes.map(d => d.toFixed(3)).join(' → ')}
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
          🎯 点击 Q1 画布磁吸拾取圆心 (cx, cy)
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
            <input type="number" id="numStartDeg" value="${layer.startDeg}" min="-360" max="360" step="0.5" />
          </div>
          <div class="field-row">
            <div class="field-label"><span>终止角 (°)</span></div>
            <input type="number" id="numEndDeg" value="${layer.endDeg}" min="-360" max="360" step="0.5" />
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
        <button class="btn ${this.pickTarget === 'p1' ? 'active' : ''}" id="btnPickP1" style="justify-content:center">🟢 在画布上磁吸点选起点 P1</button>

        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>经过点 P2.X</span></div><input type="number" id="numP2X" value="${layer.x2}" step="10" /></div>
          <div class="field-row"><div class="field-label"><span>经过点 P2.Y</span></div><input type="number" id="numP2Y" value="${layer.y2}" step="10" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'p2' ? 'active' : ''}" id="btnPickP2" style="justify-content:center">🟡 在画布上磁吸点选中间点 P2</button>

        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>终点 P3.X</span></div><input type="number" id="numP3X" value="${layer.x3}" step="10" /></div>
          <div class="field-row"><div class="field-label"><span>终点 P3.Y</span></div><input type="number" id="numP3Y" value="${layer.y3}" step="10" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'p3' ? 'active' : ''}" id="btnPickP3" style="justify-content:center">🟣 在画布上磁吸点选终点 P3</button>

        <label class="checkbox-row">
          <input type="checkbox" id="chk3PtFullCircle" ${layer.fullCircle ? 'checked' : ''} />
          <span>闭合为完整整圆 (Full Circle)</span>
        </label>
      `;
    } else if (layer.type === 'rect_or_line') {
      const totalDist = Math.hypot((Number(layer.x2) || 0) - (Number(layer.x1) || 0), (Number(layer.y2) || 0) - (Number(layer.y1) || 0));
      const trimmed = trimLineSegment(
        Number(layer.x1) || 0, Number(layer.y1) || 0,
        Number(layer.x2) || 0, Number(layer.y2) || 0,
        layer.trimStart, layer.trimEnd
      );
      html += `
        <div class="field-row">
          <div class="field-label"><span>几何子类型</span></div>
          <select id="inspRectSubMode">
            <option value="custom_segment" ${layer.subMode === 'custom_segment' ? 'selected' : ''}>任意两点连线 (如车位 → Boost Pad 引导线)</option>
            <option value="hline_y0" ${layer.subMode === 'hline_y0' ? 'selected' : ''}>水平直线 (如 Y=0 中场线)</option>
            <option value="vline_x0" ${layer.subMode === 'vline_x0' ? 'selected' : ''}>垂直直线 (如 X=0 中轴线)</option>
            <option value="rect_box" ${layer.subMode === 'rect_box' ? 'selected' : ''}>矩形框 / 禁区框 (Rect Box)</option>
          </select>
        </div>

        <div class="hint-box">
          📏 <b>两点总间距</b>: <b>${totalDist.toFixed(1)} UU</b> | 扣除首尾跳过后<b>实际绘制长度</b>: <b>${trimmed.drawnLen.toFixed(1)} UU</b>
        </div>

        <div class="field-row">
          <div class="field-label"><span>起点 P1 快速吸附锚点 (#KO车位 / #S/#B垫子)</span></div>
          <select id="inspLineAnchor1">
            <option value="custom">-- 自定义坐标 (或点击下方按钮在画布磁吸点选) --</option>
            ${Q1_NAMED_ANCHORS.map(a => `<option value="${a.id}" ${(Math.abs(layer.x1 - a.x) < 1 && Math.abs(layer.y1 - a.y) < 1) ? 'selected' : ''}>${a.label}</option>`).join('')}
          </select>
        </div>
        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>起点 X1 (UU)</span></div><input type="number" id="numRectX1" value="${layer.x1}" step="8" /></div>
          <div class="field-row"><div class="field-label"><span>起点 Y1 (UU)</span></div><input type="number" id="numRectY1" value="${layer.y1}" step="8" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'seg_p1' ? 'active' : ''}" id="btnPickSegP1" style="justify-content:center">
          🟢 在画布上磁吸点选起点 P1 (自动就近吸附锚点)
        </button>

        <div class="field-row" style="margin-top:4px">
          <div class="field-label"><span>终点 P2 快速吸附锚点 (#KO车位 / #S/#B垫子)</span></div>
          <select id="inspLineAnchor2">
            <option value="custom">-- 自定义坐标 (或点击下方按钮在画布磁吸点选) --</option>
            ${Q1_NAMED_ANCHORS.map(a => `<option value="${a.id}" ${(Math.abs(layer.x2 - a.x) < 1 && Math.abs(layer.y2 - a.y) < 1) ? 'selected' : ''}>${a.label}</option>`).join('')}
          </select>
        </div>
        <div class="field-grid-2">
          <div class="field-row"><div class="field-label"><span>终点 X2 (UU)</span></div><input type="number" id="numRectX2" value="${layer.x2}" step="8" /></div>
          <div class="field-row"><div class="field-label"><span>终点 Y2 (UU)</span></div><input type="number" id="numRectY2" value="${layer.y2}" step="8" /></div>
        </div>
        <button class="btn ${this.pickTarget === 'seg_p2' ? 'active' : ''}" id="btnPickSegP2" style="justify-content:center">
          🔴 在画布上磁吸点选终点 P2 (自动就近吸附锚点)
        </button>
      `;
    } else if (layer.type === 'boost_pad_group') {
      const inW = layer.inwardWidth ?? layer.strokeWidth ?? 10;
      const inOff = layer.insetFromPickup ?? 0;
      html += `
        <div class="hint-box">
          💡 <b>向内收环模式</b>：大垫子判定圆 <b>R=208</b> (绘制 <b>${208 - inOff - inW}~${208 - inOff} UU</b>)，小垫子判定圆 <b>R=144</b> (绘制 <b>${144 - inOff - inW}~${144 - inOff} UU</b>)。
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
      const cLen = layer.cornerLength ?? 28;
      html += `
        <div class="hint-box">
          🚗 <b>全车型碰撞箱最小外接矩形 (Union AABB)</b>：<br/>
          综合全部 7 种碰撞箱（Plank 最宽 <code>87.17 UU</code> &amp; 车尾最靠后 <code>-56.65 UU</code>；Breakout 车头最靠前 <code>+79.50 UU</code>），最小外接矩形尺寸为 <b>136.15 × 87.17 UU</b>，仅在四个角留出折角标线！
        </div>
        <div class="field-row">
          <div class="field-label"><span>目标生成点位置</span></div>
          <select id="inspTargetSpawns">
            <option value="both" ${layer.targetSpawns === 'both' ? 'selected' : ''}>全部生成点 (开球点 #KO1~3 + 复活点 #DM1~2)</option>
            <option value="kickoff" ${layer.targetSpawns === 'kickoff' ? 'selected' : ''}>仅开球出生点 (#KO1 ~ #KO3)</option>
            <option value="demo" ${layer.targetSpawns === 'demo' ? 'selected' : ''}>仅被炸复活点 (#DM1 ~ #DM2)</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field-label"><span>标记样式</span></div>
          <select id="inspSpawnShape">
            <option value="union_corners" ${layer.shape === 'union_corners' ? 'selected' : ''}>全车型最小包围矩形 — 四角 L 形折角框 (推荐)</option>
            <option value="union_rect" ${layer.shape === 'union_rect' ? 'selected' : ''}>全车型最小包围矩形 — 完整闭合框</option>
            <option value="hitbox_outline" ${layer.shape === 'hitbox_outline' ? 'selected' : ''}>单一车型碰撞箱矩形 (Octane)</option>
            <option value="crosshair" ${layer.shape === 'crosshair' ? 'selected' : ''}>中心十字准星</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field-label">
            <span>四角折线臂长 (Corner Arm Length UU)</span>
            <span class="field-val" id="lblCornerLen">${cLen} UU</span>
          </div>
          <div class="field-inline">
            <input type="range" id="rngCornerLen" min="6" max="65" step="2" value="${cLen}" />
            <input type="number" id="numCornerLen" value="${cLen}" style="width:74px" />
          </div>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="chkSpawnHugOuter" ${layer.hugOuterEdge !== false ? 'checked' : ''} />
          <span>折角内沿紧贴最小包围矩形外缘 (不侵入车体)</span>
        </label>
        <div class="field-row">
          <div class="field-label"><span>额外外扩间距 (Expand Margin UU)</span></div>
          <input type="number" id="numSpawnMargin" value="${layer.expandMargin ?? 0}" step="2" />
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
              <span>线条粗细 (Stroke Width UU)</span>
              <span class="field-val" id="lblStrokeW">${layer.strokeWidth ?? 20} UU</span>
            </div>
            <div class="field-inline">
              <input type="range" id="rngStrokeW" min="1" max="250" step="1" value="${layer.strokeWidth ?? 20}" />
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
              <input type="number" id="numDashLen" value="${layer.dashLength || 0}" min="0" max="1000" step="5" />
            </div>
            <div class="field-row">
              <div class="field-label"><span>虚线空隙 (Gap UU)</span></div>
              <input type="number" id="numGapLen" value="${layer.gapLength || 0}" min="0" max="1000" step="5" />
            </div>
          </div>
          <div class="field-row">
            <div class="field-label"><span>虚线相位偏移 (Dash Offset UU)</span></div>
            <input type="number" id="numDashOffset" value="${layer.dashOffset || 0}" step="10" />
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
    const syncJsonBox = () => {
      const txtJson = document.getElementById('txtSingleLayerJson');
      if (txtJson && document.getElementById('singleLayerJsonBox')?.style.display !== 'none') {
        txtJson.value = JSON.stringify(layer, null, 2);
      }
    };

    const bindVal = (id, prop, isNum = true, rerenderInspector = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.oninput = (e) => {
        layer[prop] = isNum ? parseFloat(e.target.value) || 0 : e.target.value;
        if (prop === 'name') this.renderLayerList();
        syncJsonBox();
        if (rerenderInspector) this.renderInspector();
        this.saveAndRenderCanvas();
      };
    };

    bindVal('inspName', 'name', false);
    bindVal('numTrimStart', 'trimStart', true, layer.type === 'rect_or_line');
    bindVal('numTrimEnd', 'trimEnd', true, layer.type === 'rect_or_line');

    // Bind Grayscale & Color Palette controls in Inspector
    const levels = this.project.colorPalettePreview?.levels || DEFAULT_GRAY_PALETTE_LEVELS;
    const maxLvl = levels.length - 1;
    const applyLayerLevel = (newLvl) => {
      const lv = Math.max(1, Math.min(maxLvl, parseInt(newLvl, 10) || 1));
      layer.grayLevel = lv;
      const found = levels.find(l => l.level === lv);
      if (found) layer.gray = found.gray;
      syncJsonBox();
      this.renderPaletteLevels();
      this.renderLayerList();
      this.renderInspector();
      this.saveAndRenderCanvas();
    };

    const selInspLvl = document.getElementById('selInspGrayLevel');
    if (selInspLvl) {
      selInspLvl.onchange = (e) => applyLayerLevel(e.target.value);
    }

    document.querySelectorAll('.btn-quick-lvl').forEach((btn) => {
      btn.onclick = () => applyLayerLevel(btn.getAttribute('data-lvl'));
    });

    const colInspLvl = document.getElementById('colInspLevelColor');
    if (colInspLvl) {
      colInspLvl.oninput = (e) => {
        const curLv = Number(layer.grayLevel ?? maxLvl);
        const found = levels.find(l => l.level === curLv);
        if (found) {
          found.color = e.target.value;
          this.renderPaletteLevels();
          this.renderLayerList();
          this.saveAndRenderCanvas();
        }
      };
    }

    const chkCutSafe = document.getElementById('chkCutBySafeArea');
    if (chkCutSafe) {
      chkCutSafe.onchange = (e) => {
        layer.cutBySmallPadSafeArea = e.target.checked;
        syncJsonBox();
        this.saveAndRenderCanvas();
      };
    }

    const chkHugInner = document.getElementById('chkHugInner');
    if (chkHugInner) {
      chkHugInner.onchange = (e) => {
        layer.hugInnerEdge = e.target.checked;
        syncJsonBox();
        this.saveAndRenderCanvas();
      };
    }

    const chkSpawnHugOuter = document.getElementById('chkSpawnHugOuter');
    if (chkSpawnHugOuter) {
      chkSpawnHugOuter.onchange = (e) => {
        layer.hugOuterEdge = e.target.checked;
        syncJsonBox();
        this.saveAndRenderCanvas();
      };
    }

    const bindPair = (rngId, numId, lblId, prop, unit = '', rerender = false, customFmt = null) => {
      const rng = document.getElementById(rngId);
      const num = document.getElementById(numId);
      const lbl = document.getElementById(lblId);
      if (!rng || !num) return;
      const update = (val) => {
        const v = parseFloat(val) || 0;
        layer[prop] = v;
        rng.value = v;
        num.value = v;
        if (lbl) lbl.textContent = customFmt ? customFmt(v) : `${v}${unit}`;
        if (prop === 'gray' && layer.grayLevel >= 1 && layer.grayLevel <= maxLvl) {
          const found = levels.find(l => l.level === Number(layer.grayLevel));
          if (found) {
            found.gray = Math.max(0, Math.min(255, Math.round(v)));
            this.renderPaletteLevels();
          }
        }
        syncJsonBox();
        if (rerender) this.renderInspector();
        this.saveAndRenderCanvas();
      };
      rng.oninput = (e) => update(e.target.value);
      num.oninput = (e) => update(e.target.value);
    };

    bindPair('rngInsetDist', 'numInsetDist', 'lblInsetDist', 'insetDist', ' UU');
    bindPair('rngMidExpand', 'numMidExpand', 'lblMidExpand', 'midXExpand', ' UU', true, (v) => `+${v} UU (X=${2048 + v})`);
    bindPair('rngRadius', 'numRadius', 'lblRadius', 'radius', ' UU');
    bindPair('rngInwardW', 'numInwardW', 'lblInwardW', 'inwardWidth', ' UU', true);
    bindPair('rngCornerLen', 'numCornerLen', 'lblCornerLen', 'cornerLength', ' UU');
    bindPair('rngStrokeW', 'numStrokeW', 'lblStrokeW', 'strokeWidth', ' UU');
    bindPair('rngGray', 'numGray', 'lblGray', 'gray', '');

    bindVal('numSplineTension', 'tension', true);
    bindVal('selEndSlopeMode', 'endSlopeMode', false);

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

    const selAnchor1 = document.getElementById('inspLineAnchor1');
    if (selAnchor1) {
      selAnchor1.onchange = (e) => {
        const found = Q1_NAMED_ANCHORS.find(a => a.id === e.target.value);
        if (found) {
          layer.anchor1 = found.id;
          layer.x1 = found.x;
          layer.y1 = found.y;
          this.renderInspector();
          this.saveAndRenderCanvas();
        }
      };
    }

    const selAnchor2 = document.getElementById('inspLineAnchor2');
    if (selAnchor2) {
      selAnchor2.onchange = (e) => {
        const found = Q1_NAMED_ANCHORS.find(a => a.id === e.target.value);
        if (found) {
          layer.anchor2 = found.id;
          layer.x2 = found.x;
          layer.y2 = found.y;
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
    bindPickBtn('btnPickSegP1', 'seg_p1');
    bindPickBtn('btnPickSegP2', 'seg_p2');

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
        syncJsonBox();
        this.saveAndRenderCanvas();
      };
    }

    bindVal('inspRectSubMode', 'subMode', false, true);
    bindVal('numRectX1', 'x1', true, true);
    bindVal('numRectY1', 'y1', true, true);
    bindVal('numRectX2', 'x2', true, true);
    bindVal('numRectY2', 'y2', true, true);

    bindVal('inspTargetPads', 'targetPads', false);
    bindVal('numInsetFromPickup', 'insetFromPickup', true, true);

    bindVal('inspTargetSpawns', 'targetSpawns', false);
    bindVal('inspSpawnShape', 'shape', false, true);
    bindVal('numSpawnMargin', 'expandMargin', true);

    bindVal('inspStripeOrient', 'orientation', false);
    bindVal('numStripeSpan', 'stripeSpan', true);
    bindVal('numTurfInset', 'insetFromFloor', true);

    bindVal('numDashLen', 'dashLength', true);
    bindVal('numGapLen', 'gapLength', true);
    bindVal('numDashOffset', 'dashOffset', true);
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
      activeLayerId: this.selectedLayerId,
      hoveredLayerId: this.hoveredLayerId,
      snappedAnchor: this.snappedAnchor
    });
    const svgFull = buildArenaSvgString(this.project, {
      mode: 'full_mirror',
      includeReference: true,
      useShaderPreview: useShader,
      activeLayerId: this.selectedLayerId,
      hoveredLayerId: this.hoveredLayerId,
      snappedAnchor: this.snappedAnchor
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
      const snap = this.magneticSnapEnabled ? findNearestAnchor(pt.q1x, pt.q1y, Q1_NAMED_ANCHORS, 250) : null;

      document.getElementById('lblCursorCoord').textContent = snap
        ? `🧲 吸附 [${snap.code}] (${snap.x}, ${snap.y}) UU`
        : `X: ${pt.x} UU, Y: ${pt.y} UU (Q1: ${pt.q1x}, ${pt.q1y})`;

      // Find nearest layer to cursor for hover highlight
      let bestLayer = null;
      let bestDist = 140;
      for (const l of this.project.layers) {
        if (!l.visible) continue;
        const d = distanceToLayerQ1(l, pt.q1x, pt.q1y);
        if (d < bestDist) {
          bestDist = d;
          bestLayer = l;
        }
      }

      const hoverLbl = document.getElementById('lblHoverLayer');
      if (bestLayer) {
        hoverLbl.textContent = `🔍 靠近图层: [${bestLayer.name}] (点击直接选中)`;
      } else {
        hoverLbl.textContent = '';
      }

      const prevHoverId = this.hoveredLayerId;
      const prevSnapId = this.snappedAnchor?.id || null;
      this.hoveredLayerId = bestLayer?.id || null;
      this.snappedAnchor = this.pickTarget ? snap : null;

      if (prevHoverId !== this.hoveredLayerId || prevSnapId !== (this.snappedAnchor?.id || null)) {
        this.saveAndRenderCanvas();
      }
    };

    svgEl.onclick = (evt) => {
      const pt = clientToUU(evt);
      const snap = this.magneticSnapEnabled ? findNearestAnchor(pt.q1x, pt.q1y, Q1_NAMED_ANCHORS, 250) : null;
      const targetX = snap ? snap.x : pt.q1x;
      const targetY = snap ? snap.y : pt.q1y;

      const layer = this.getSelectedLayer();

      if (layer && this.pickTarget) {
        if (this.pickTarget === 'center' && layer.type === 'circle_arc') {
          layer.cx = targetX;
          layer.cy = targetY;
          this.pickTarget = null;
        } else if (layer.type === 'rect_or_line') {
          if (this.pickTarget === 'seg_p1') {
            layer.x1 = targetX;
            layer.y1 = targetY;
            if (snap) layer.anchor1 = snap.id;
            this.pickTarget = 'seg_p2'; // Auto-advance to P2!
          } else if (this.pickTarget === 'seg_p2') {
            layer.x2 = targetX;
            layer.y2 = targetY;
            if (snap) layer.anchor2 = snap.id;
            this.pickTarget = null;
          }
        } else if (layer.type === 'three_point_arc') {
          if (this.pickTarget === 'p1') {
            layer.x1 = targetX;
            layer.y1 = targetY;
            this.pickTarget = 'p2';
          } else if (this.pickTarget === 'p2') {
            layer.x2 = targetX;
            layer.y2 = targetY;
            this.pickTarget = 'p3';
          } else if (this.pickTarget === 'p3') {
            layer.x3 = targetX;
            layer.y3 = targetY;
            this.pickTarget = null;
          }
        }
        this.snappedAnchor = null;
        this.renderInspector();
        this.saveAndRenderCanvas();
        return;
      }

      // If not in point-picking mode, clicking near any line on the canvas selects that layer!
      if (this.hoveredLayerId && this.hoveredLayerId !== this.selectedLayerId) {
        this.selectedLayerId = this.hoveredLayerId;
        this.renderLayerList();
        this.renderInspector();
        this.saveAndRenderCanvas();
      }
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
            this.project = this.ensurePaletteLevels({
              ...JSON.parse(JSON.stringify(DEFAULT_PROJECT)),
              ...parsed,
              colorPalettePreview: {
                ...JSON.parse(JSON.stringify(DEFAULT_PROJECT.colorPalettePreview)),
                ...(parsed.colorPalettePreview || {})
              },
              shaderPreview: { ...DEFAULT_PROJECT.shaderPreview, ...(parsed.shaderPreview || {}) },
              referenceOverlays: { ...DEFAULT_PROJECT.referenceOverlays, ...(parsed.referenceOverlays || {}) }
            });
            this.selectedLayerId = this.project.layers[0]?.id || null;
            document.getElementById('chkColorPalettePreview').checked = Boolean(this.project.colorPalettePreview?.enabled);
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
