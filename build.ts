// Builds a Google Merchant / Pinterest catalog feed (RSS 2.0 + g:) from the public WooCommerce Store API.
const SITE = "https://atelierm.ro";
const out = process.argv[2] ?? "feed.xml";

type Product = {
  id: number; name: string; permalink: string; short_description: string; description: string;
  is_in_stock: boolean; images: { src: string }[]; categories: { name: string; link: string }[];
  prices: { price: string; regular_price: string; sale_price: string; currency_code: string; currency_minor_unit: number };
};

const products: Product[] = [];
let total: number | undefined;
for (let page = 1; ; page++) {
  const res = await fetch(`${SITE}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
  if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
  total ??= Number(res.headers.get("x-wp-total") ?? NaN);
  const batch = (await res.json()) as Product[];
  products.push(...batch);
  if (batch.length < 100 || products.length >= total) break;
}
// A missing or mismatched total means a partial read; publishing it would delist the missing products.
if (products.length !== total) throw new Error(`read ${products.length} products but the shop reports x-wp-total=${total}`);

const decode = (s: string) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (p: Product["prices"], v: string) => `${(+v / 10 ** p.currency_minor_unit).toFixed(2)} ${p.currency_code}`;

// Shop category path → Google product category id (taxonomy-with-ids.en-US.txt); first match wins, most specific first.
const GPC: [RegExp, number][] = [
  [/ateliere-creative\//, 16], // Arts & Crafts (workshops)
  [/seturi/, 7313], // Outfit Sets
  [/\/rochii\//, 2271], // Dresses
  [/\/fuste\//, 1581], // Skirts
  [/\/trench\//, 5598], // Coats & Jackets
  [/\/(bluze|tricouri|hanorace|cardigane)\//, 212], // Shirts & Tops
  [/set-cercei-brosa\//, 6463], // Jewelry Sets
  [/\/(brosa|martisor)\//, 197], // Brooches & Lapel Pins
  [/\/cercei\//, 194], // Earrings
  [/\/coliere\//, 196], // Necklaces
  [/\/bijuterii\//, 188], // Jewelry
  [/\/posete\//, 3032], // Handbags
  [/\/rucsacuri\//, 100], // Backpacks
  [/\/papusi\//, 1257], // Dolls
  [/\/perne-decorative\//, 4454], // Throw Pillows
  [/\/set-decorativ-masa\//, 601], // Table Linens
  [/\/de-imbracat\//, 1604], // Clothing
  [/\/deco-si-accesorii\//, 696], // Decor
];

const items = products.filter(p => p.images.length && +p.prices.price > 0).map(p => {
  const paths = p.categories.map(c => c.link).join(" ");
  const gpc = GPC.find(([re]) => re.test(paths))?.[1] ?? 166; // 166 = Apparel & Accessories
  const extraImages = [...new Set(p.images.slice(1).map(i => i.src))].filter(src => src !== p.images[0].src).slice(0, 10);
  const title = decode(p.name).slice(0, 150);
  const desc = (decode(p.description) || decode(p.short_description) || title).slice(0, 5000);
  const sale = p.prices.sale_price !== p.prices.regular_price;
  return `<item>
<g:id>${p.id}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(desc)}</g:description>
<g:link>${esc(p.permalink)}</g:link>
<g:image_link>${esc(p.images[0].src)}</g:image_link>
${extraImages.map(src => `<g:additional_image_link>${esc(src)}</g:additional_image_link>`).join("\n")}
<g:availability>${p.is_in_stock ? "in_stock" : "out_of_stock"}</g:availability>
<g:price>${money(p.prices, p.prices.regular_price)}</g:price>
${sale ? `<g:sale_price>${money(p.prices, p.prices.sale_price)}</g:sale_price>` : ""}
<g:condition>new</g:condition>
<g:brand>AtelierM</g:brand>
<g:identifier_exists>no</g:identifier_exists>
<g:google_product_category>${gpc}</g:google_product_category>
<g:product_type>${esc(decode(p.categories.slice(0, 5).map(c => c.name).join(" > ")))}</g:product_type>
</item>`;
});

if (items.length === 0) throw new Error("no products with image and price; refusing to publish an empty feed");

await Bun.write(out, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>AtelierM</title><link>${SITE}</link><description>Pictură manuală pe țesătură, Brașov</description><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
</channel></rss>
`);
console.log(`${items.length}/${products.length} products -> ${out}`);
