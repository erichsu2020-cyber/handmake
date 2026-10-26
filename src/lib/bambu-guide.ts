import {
  findFilament,
  findSetup,
  nearestLayerHeight,
  withDefaultTemps,
  type BambuSettings,
} from "@/lib/bambu-settings";

// Bambu 設定頁的說明內容：每個參數的用途、選項比較、建議，以及依產品類型的推薦設定
// 數字都是一般經驗值（例如列印時間是跟 0.20 mm 層高相比的大約倍數），實際會依模型而不同

export type Guide = {
  purpose: string;
  table?: { head: string[]; rows: string[][] };
  tips?: string[];
};

export const GUIDES = {
  productType: {
    purpose: "先選你要印的東西是什麼，會一次套用適合的線材和列印參數，之後還可以再細調。",
    tips: ["不確定的話，擺著看的選「公仔／雕像」，要受力或組裝的選「功能件／機構件」。"],
  },
  printer: {
    purpose: "選你實際要用的印表機。不同機型的列印範圍、開機流程（G-code）和可用線材都不一樣，選錯可能無法正常列印。",
    table: {
      head: ["機型", "列印範圍", "特點"],
      rows: [
        ["H2S", "340×320×340 mm", "大尺寸、密閉機箱，可印 ABS 等高溫材料"],
        ["X1 Carbon", "256×256×250 mm", "密閉機箱、原廠硬化鋼噴嘴，可印碳纖維材料"],
        ["P1S", "256×256×250 mm", "密閉機箱，適合 ABS"],
        ["P1P", "256×256×250 mm", "開放式，適合 PLA、PETG"],
        ["P2S", "256×256×256 mm", "密閉機箱"],
        ["A1", "256×256×256 mm", "開放式（熱床前後移動），適合 PLA、PETG、TPU"],
        ["A1 mini", "180×180×180 mm", "小型開放式，適合小模型"],
      ],
    },
  },
  nozzle: {
    purpose: "噴嘴口徑決定擠出的線有多粗：越小細節越好但越慢，越大越快、越堅固但表面越粗。要選印表機上實際裝的噴嘴。",
    table: {
      head: ["噴嘴", "細節", "速度", "適合"],
      rows: [
        ["0.2 mm", "最細", "很慢（約 ×3）", "迷你公仔、細小文字"],
        ["0.4 mm", "一般", "標準", "大部分模型（原廠噴嘴）"],
        ["0.6 mm", "較粗", "較快（約 ×0.6）", "大型模型、功能件"],
        ["0.8 mm", "粗", "很快（約 ×0.4）", "大型花瓶、快速打樣"],
      ],
    },
    tips: ["換噴嘴後可用的層高會跟著改變，大約是噴嘴口徑的 25%–75%。"],
  },
  filament: {
    purpose: "線材決定成品的外觀、強度和耐熱程度。這裡用的是 Bambu 官方的線材設定。",
    table: {
      head: ["線材", "難度", "強度", "耐熱", "適合"],
      rows: [
        ["PLA Basic", "最容易", "中", "約 55°C", "一般模型、打樣"],
        ["PLA Matte", "最容易", "中", "約 55°C", "公仔（霧面能隱藏層紋）"],
        ["PLA Silk+", "容易", "中低", "約 55°C", "絲綢光澤的裝飾品"],
        ["PLA Marble", "容易", "中", "約 55°C", "大理石紋的擺件"],
        ["PLA Translucent", "容易", "中", "約 55°C", "燈罩、透光作品"],
        ["PETG Basic／HF", "中", "高、有韌性", "約 70°C", "功能件、戶外、餐廚收納（HF 可印得更快）"],
        ["PETG Translucent", "中", "高", "約 70°C", "透光又需要強度的作品"],
        ["PETG-CF", "中", "很硬", "約 75°C", "高剛性零件，需要硬化鋼噴嘴"],
        ["ABS", "難", "高", "約 90°C", "耐熱零件，需要密閉機箱、注意通風"],
        ["TPU 95A HF", "難", "有彈性", "約 60°C", "手機殼、防滑墊、軟性零件"],
      ],
    },
    tips: [
      "會放在車內、陽光下或接觸熱水的東西，不要用 PLA，改用 PETG 或 ABS。",
      "TPU 大多不能經過 AMS 自動換料，要直接裝在外掛料架上。",
    ],
  },
  plate: {
    purpose: "列印板的表面會影響模型能不能黏住、好不好拆，以及底面的外觀。要選印表機上實際放的板子。",
    table: {
      head: ["列印板", "底面外觀", "黏著", "注意"],
      rows: [
        ["紋理 PEI 板", "細顆粒紋理", "好、冷卻後容易拆", "最萬用，PETG 也不會黏太死"],
        ["光滑 PEI 板／高溫板", "光滑亮面", "很好", "PETG、TPU 可能黏太緊，建議先塗膠水隔離"],
        ["低溫板", "光滑", "PLA 需要塗膠水", "只適合 PLA、TPU 等低溫材料"],
      ],
    },
  },
  nozzleTemp: {
    purpose: "噴嘴加熱的溫度。預設帶入官方建議值，一般不需要改。",
    table: {
      head: ["調整", "優點", "缺點"],
      rows: [
        ["調高 5–10°C", "層與層黏得更牢、強度更好、絲綢線材更亮", "比較容易牽絲、懸空處容易下垂"],
        ["調低 5–10°C", "牽絲變少、懸空和細節比較漂亮", "層間結合變弱，太低可能堵頭"],
      ],
    },
    tips: ["一次只調 5°C，看結果再決定；首層溫度會跟著一起調整。"],
  },
  bedTemp: {
    purpose: "熱床的溫度，主要影響模型能不能黏住平台、會不會翹邊。",
    tips: [
      "模型四角翹起來：調高 5°C，或開啟 Brim。",
      "PLA 底部向外擴（象腳）：調低 5°C。",
      "ABS 需要 90–100°C，而且要關上機箱門。",
    ],
  },
  quickPreset: {
    purpose: "一鍵套用常見的品質組合，只會換掉層高、牆數、頂底層和填充，其他設定不變。",
    table: {
      head: ["預設", "層高", "牆數", "填充", "適合"],
      rows: [
        ["草稿", "0.28", "2", "10%", "快速確認尺寸和外型"],
        ["標準", "0.20", "2", "15%", "大部分模型"],
        ["精細", "0.12", "3", "15% 螺旋", "公仔、細節多的模型"],
        ["堅固", "0.20", "4", "30% 螺旋", "要受力的功能件"],
      ],
    },
  },
  layerHeight: {
    purpose: "每一層的厚度，決定表面的細緻程度和列印時間。",
    table: {
      head: ["層高", "表面", "時間（約）", "適合"],
      rows: [
        ["0.08", "最細，幾乎看不到層紋", "×2.5", "小公仔的臉部、精細浮雕"],
        ["0.12", "很細", "×1.7", "公仔、雕像"],
        ["0.16", "細", "×1.25", "細節和速度的平衡"],
        ["0.20", "一般", "×1", "大部分模型"],
        ["0.24–0.28", "層紋明顯", "×0.75–0.85", "功能件、草稿、大型模型"],
      ],
    },
    tips: [
      "層高越小，斜面和曲面越平滑；垂直的牆面差異不大。",
      "功能件用 0.20 就很夠了，層高小不會比較堅固。",
    ],
  },
  wallLoops: {
    purpose: "模型外圍要印幾圈。外牆是強度的主要來源，比加填充更有效。",
    table: {
      head: ["牆數", "強度", "適合"],
      rows: [
        ["1", "很弱", "只適合花瓶模式這類特殊用途"],
        ["2", "一般", "擺件、一般模型"],
        ["3", "較好，表面也更平整", "公仔、需要打磨上色的模型"],
        ["4–6", "很堅固", "受力零件、螺絲孔、卡扣"],
      ],
    },
    tips: ["要鎖螺絲或攻牙的地方，至少用 4 圈牆，螺絲才有足夠的材料可以咬住。"],
  },
  shellLayers: {
    purpose: "頂部和底部要印幾層實心面。層數 × 層高 = 實際厚度，頂部太薄會看到底下的填充紋路。",
    tips: [
      "頂部建議至少 0.8 mm，底部至少 0.6 mm；層高越小，需要的層數越多。",
      "頂面坑坑洞洞或看得到填充紋路：增加頂層數或提高填充密度。",
    ],
  },
  infillDensity: {
    purpose: "模型內部要填多滿。越高越重、越堅固，但時間和用料增加很多。",
    table: {
      head: ["密度", "強度", "適合"],
      rows: [
        ["0–10%", "只撐住頂面", "擺件、公仔"],
        ["15–20%", "一般", "大部分模型"],
        ["25–40%", "堅固", "功能件、工具"],
        ["50% 以上", "很堅固但效益遞減", "很少需要，加牆數通常更有效"],
      ],
    },
  },
  infillPattern: {
    purpose: "內部填充的形狀，會影響強度的方向、速度和用料。",
    table: {
      head: ["圖案", "強度", "速度", "適合"],
      rows: [
        ["網格", "中，有方向性", "快", "一般模型（Bambu 預設）"],
        ["螺旋（Gyroid）", "各方向平均", "中", "公仔、功能件、TPU"],
        ["立方", "立體方向都強", "中", "功能件"],
        ["蜂巢", "很強", "慢", "需要高強度的零件"],
        ["三角形", "平面方向很硬", "中", "平板、支架類零件"],
        ["閃電", "幾乎沒有", "最快、最省料", "只是擺著看的公仔、擺件"],
      ],
    },
  },
  support: {
    purpose: "在懸空的部位下面印支撐架，避免塌陷，印完再拆掉。",
    tips: [
      "需要支撐：手臂、下巴、帽緣這類大角度懸空，或沒有東西托住的平面。",
      "不需要：花瓶、盒子這類往上收或垂直的形狀，以及 45° 以內的斜面。",
      "支撐會在接觸面留下痕跡，能換個方向擺放避免懸空的話，效果通常更好。",
    ],
  },
  supportType: {
    purpose: "支撐架的形狀。",
    table: {
      head: ["類型", "拆除", "痕跡", "適合"],
      rows: [
        ["樹狀（自動）", "容易", "少", "公仔、雕像這類曲面、有機外形"],
        ["一般（自動）", "較難", "較多，但平面撐得較平", "機構件、大面積的平面懸空"],
      ],
    },
  },
  supportAngle: {
    purpose: "懸空面跟水平面的夾角小於這個角度才會加支撐。數字越大，加的支撐越多。",
    table: {
      head: ["設定", "效果"],
      rows: [
        ["20°", "支撐最少，只撐很平的懸空，比較省料、好拆"],
        ["30°", "Bambu 預設，大部分模型適用"],
        ["40–45°", "支撐較多，懸空表面比較漂亮"],
        ["0", "交給 Bambu Studio 依線材自動判斷"],
      ],
    },
  },
  brim: {
    purpose: "在模型底部外圍多印一圈薄薄的邊，增加黏著面積，印完再撕掉。",
    table: {
      head: ["選項", "適合"],
      rows: [
        ["自動", "Bambu 依模型和線材自動判斷要不要加（建議）"],
        ["僅外側", "底面很小、又高又細，或容易翹邊的 ABS"],
        ["無", "底面很大很穩，或不想在底部留下痕跡"],
      ],
    },
  },
} satisfies Record<string, Guide>;

type ProductSettings = Pick<
  BambuSettings,
  | "layerHeight"
  | "wallLoops"
  | "topLayers"
  | "bottomLayers"
  | "infillDensity"
  | "infillPattern"
  | "support"
  | "supportType"
  | "supportAngle"
  | "brim"
>;

export type ProductType = {
  value: string;
  label: string;
  description: string;
  // 依序嘗試，用這台印表機＋噴嘴第一個有的線材
  filaments: string[];
  settings: ProductSettings;
  reasons: string[];
};

export const PRODUCT_TYPES: ProductType[] = [
  {
    value: "figurine",
    label: "公仔／雕像",
    description: "擺著看、細節多、有曲面",
    filaments: ["PLA Matte", "PLA Basic"],
    settings: {
      layerHeight: 0.12,
      wallLoops: 3,
      topLayers: 7,
      bottomLayers: 5,
      infillDensity: 10,
      infillPattern: "gyroid",
      support: true,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "PLA Matte 霧面能隱藏層紋，看起來更像成品",
      "0.12 mm 層高讓臉部和曲面更平滑",
      "3 圈牆讓表面平整，之後打磨上色也不怕磨穿",
      "10% 填充就夠撐住頂面，省料又省時間",
      "樹狀支撐好拆、留下的痕跡少，適合手臂、下巴這類懸空",
    ],
  },
  {
    value: "functional",
    label: "功能件／機構件",
    description: "要受力、組裝、鎖螺絲",
    filaments: ["PETG HF", "PETG Basic", "PLA Basic"],
    settings: {
      layerHeight: 0.2,
      wallLoops: 4,
      topLayers: 5,
      bottomLayers: 4,
      infillDensity: 30,
      infillPattern: "cubic",
      support: true,
      supportType: "normal(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "PETG 比 PLA 有韌性、耐熱，受力時比較不會突然斷掉",
      "0.20 mm 層高：層高小不會比較堅固，反而更花時間",
      "4 圈牆是強度的主要來源，螺絲孔也有足夠的材料",
      "30% 立方填充，立體各方向都有支撐力",
      "一般支撐能把平面懸空撐得比較平，尺寸較準",
    ],
  },
  {
    value: "container",
    label: "花瓶／收納容器",
    description: "中空、往上開口",
    filaments: ["PLA Basic", "PETG HF"],
    settings: {
      layerHeight: 0.2,
      wallLoops: 3,
      topLayers: 4,
      bottomLayers: 5,
      infillDensity: 15,
      infillPattern: "grid",
      support: false,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "容器的形狀大多往上收或垂直，通常不需要支撐",
      "3 圈牆讓側壁更厚實、不容易漏水",
      "底部 5 層讓底座穩固、不透光",
      "要裝水或接觸食物建議改用 PETG，PLA 遇熱水會變形",
    ],
  },
  {
    value: "outdoor",
    label: "戶外／耐熱用品",
    description: "曬太陽、放車上、接觸熱水",
    filaments: ["PETG HF", "PETG Basic", "ABS"],
    settings: {
      layerHeight: 0.2,
      wallLoops: 4,
      topLayers: 5,
      bottomLayers: 4,
      infillDensity: 25,
      infillPattern: "gyroid",
      support: true,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "PETG 耐熱約 70°C、耐日曬，PLA 放在車內會變形",
      "4 圈牆加上 25% 螺旋填充，各方向都夠堅固",
      "更高溫的環境可改用 ABS，但需要密閉機箱的印表機",
    ],
  },
  {
    value: "decor",
    label: "光澤裝飾品",
    description: "絲綢光澤、送禮擺件",
    filaments: ["PLA Silk+", "PLA Basic"],
    settings: {
      layerHeight: 0.16,
      wallLoops: 3,
      topLayers: 6,
      bottomLayers: 4,
      infillDensity: 10,
      infillPattern: "gyroid",
      support: true,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "PLA Silk+ 有絲綢般的光澤，適合送禮或展示",
      "0.16 mm 層高兼顧光澤感和列印時間",
      "絲綢線材層間較弱，不適合要受力的東西",
    ],
  },
  {
    value: "lamp",
    label: "燈罩／透光作品",
    description: "要讓光透出來",
    filaments: ["PLA Translucent", "PETG Translucent"],
    settings: {
      layerHeight: 0.16,
      wallLoops: 2,
      topLayers: 4,
      bottomLayers: 3,
      infillDensity: 0,
      infillPattern: "grid",
      support: false,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "auto_brim",
    },
    reasons: [
      "半透明線材讓光線均勻透出",
      "2 圈牆、0% 填充：牆越薄越透光，內部也不會有填充的陰影",
      "燈罩如果靠近燈泡，建議用 LED 燈並改用 PETG Translucent",
    ],
  },
  {
    value: "flexible",
    label: "軟性零件",
    description: "手機殼、防滑墊、要能彎",
    filaments: ["TPU 95A HF"],
    settings: {
      layerHeight: 0.2,
      wallLoops: 3,
      topLayers: 5,
      bottomLayers: 4,
      infillDensity: 20,
      infillPattern: "gyroid",
      support: false,
      supportType: "tree(auto)",
      supportAngle: 30,
      brim: "no_brim",
    },
    reasons: [
      "TPU 有彈性，可以彎折、不容易斷",
      "螺旋填充各方向的彈性比較平均",
      "TPU 很黏平台，不需要 Brim；支撐也很難拆，盡量避免",
      "TPU 大多不能經過 AMS，要直接裝在外掛料架上",
    ],
  },
  {
    value: "prototype",
    label: "快速打樣",
    description: "先確認尺寸和外型",
    filaments: ["PLA Basic"],
    settings: {
      layerHeight: 0.28,
      wallLoops: 2,
      topLayers: 3,
      bottomLayers: 3,
      infillDensity: 10,
      infillPattern: "grid",
      support: true,
      supportType: "tree(auto)",
      supportAngle: 20,
      brim: "no_brim",
    },
    reasons: [
      "最大的層高和最少的牆、填充，速度最快",
      "支撐角度設 20°，只撐真正需要的地方，省時間",
      "確認沒問題後，再換成其他產品類型印正式版",
    ],
  },
];

// 套用產品類型：印表機、噴嘴、列印板不動；線材換成這台機器有的第一個推薦線材，層高換成最接近的，溫度帶入官方值
export function applyProductType(s: BambuSettings, value: string): BambuSettings {
  const type = PRODUCT_TYPES.find((t) => t.value === value);
  const setup = findSetup(s);
  if (!type || !setup) return s;
  const filament = type.filaments.find((f) => findFilament(setup.nozzle, f)) ?? s.filament;
  const f = findFilament(setup.nozzle, filament);
  const plate = f && f.bedTemp[s.plate] === 0 ? "textured" : s.plate;
  return withDefaultTemps({
    ...s,
    ...type.settings,
    filament,
    plate,
    layerHeight: nearestLayerHeight(setup.nozzle, type.settings.layerHeight),
  });
}

// 目前的設定剛好等於哪個產品類型（線材不一定要一樣，因為有些機器沒有推薦的線材）
export function matchProductType(s: BambuSettings) {
  const setup = findSetup(s);
  if (!setup) return undefined;
  return PRODUCT_TYPES.find((t) =>
    (Object.keys(t.settings) as (keyof ProductSettings)[]).every((key) =>
      key === "layerHeight"
        ? s.layerHeight === nearestLayerHeight(setup.nozzle, t.settings.layerHeight)
        : s[key] === t.settings[key],
    ),
  )?.value;
}
