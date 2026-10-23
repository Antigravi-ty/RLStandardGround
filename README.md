# RLStandardGround — RocketSim 球场地面贴图参数化设计器 (1:1 UU)

基于 Vite 构建的 **Rocket League / RocketSim (Soccar Mode) 1:1 Unreal Units (UU)** 参数化地面贴图与 SVG 矢量设计工作室。

## 快速启动

```bash
pnpm install   # 或 npm install
pnpm dev       # 启动本地交互式编辑器 (默认 http://localhost:5173)
pnpm build     # 构建静态生产包至 dist/
```

## 核心特性

1. **双屏实时对称预览 (Q1 编辑 + 全场 4 象限镜像)**
   - 仅需在第一象限 (`Q1: X ∈ [0, 4096], Y ∈ [0, 6000]`) 调整参数，右侧视图实时经过 X/Y 轴两次对称映射生成完整的 `8192 × 12000 UU` 球场。
   - 支持一键开启 **游戏 Shader 着色模拟 (`uGroundColor` + `uLineColor` + `uLineThreshold`)**，实时预览灰度图在 `DriftwoodsMaterialManager` 中的最终渲染效果。

2. **7 类针对球场标线的参数化图层 (Parametric Layers)**
   - **沿地面边界内缩线 (`contour_offset`)**：以 `Z=0` 纯平地面轮廓 (`X ≤ 3840, Y ≤ 4964.95`) 或 `4096` 外墙轮廓为基准，按法线向内收缩 (`Inset Distance`) 指定距离，自由设置线宽、实线/虚线、灰度与矩形裁剪区 (`Clip Box`)。
   - **定点外扩圆 / 极角圆弧 (`circle_arc`)**：支持一键吸附到物理锚点（中圈原点、球门柱、任一 Boost Pad、开球点、复活点）或点击画布拾取圆心，设置外扩半径、起止角度、线宽与虚线。
   - **三点确定圆弧 (`three_point_arc`)**：支持在画布上依次点选 `P1 -> P2 -> P3` 或输入坐标，自动解算外接圆圆心与半径并生成精确圆弧（如禁区顶部的 D 形弧）。
   - **矩形禁区框 / 直线段 (`rect_or_line`)**：当贴靠 `X=0` 或 `Y=0` 对称轴时自动消除接缝重叠线。
   - **Boost Pad 批量装饰环 (`boost_pad_group`)**：一键为所有大氮气垫 (`R=208`) 或小氮气垫 (`R=144`) 批量生成内圈实心/圆环标识与外圈判定虚线环。
   - **出生点 / 被炸复活点地面框 (`spawn_marker_group`)**：严格按照 `CarConfig` 的 `hitboxPosOffset.x` 前向偏移绘制车体碰撞箱地标或准星。
   - **草坪深浅交替条纹 (`turf_stripes`)**：自动裁剪在 `Z=0` 纯平地面内缩边界之内。

3. **物理参考层与拖拽导入 / 多规格导出**
   - 内置 `Z=0` 纯平地面线、外墙线、球门进球线、Boost Pad 判定圈、开球/Demo 复活车体框参考层（导出纯净贴图时自动剥离）。
   - 支持直接拖拽 `.json` 参数工程文件或外部 `.svg` 到窗口中加载。
   - 支持一键导出 **Q1 四分之一** 或 **Full 全场** 的 `512×512`、`1024×1024`、`2048×2048` 正方形及按真实物理比例 (`1px = 2UU` 等) 的无损 PNG / WebP 灰度贴图与矢量 SVG。
