export interface SeedSubCategory {
  name: string;
  slug: string;
}

export interface SeedCategory {
  name: string;
  slug: string;
  subCategories: SeedSubCategory[];
}

export const categories: SeedCategory[] = [
  {
    name: 'Pharmaceuticals',
    slug: 'pharmaceuticals',
    subCategories: [
      { name: 'Antibiotics', slug: 'antibiotics' },
      { name: 'Pain Relief', slug: 'pain-relief' },
      { name: 'Vitamins & Supplements', slug: 'vitamins-supplements' },
      { name: 'Antacids & Digestive', slug: 'antacids-digestive' },
      { name: 'Cardiovascular', slug: 'cardiovascular' },
      { name: 'Respiratory', slug: 'respiratory' },
      { name: 'Diabetes Care', slug: 'diabetes-care' },
      { name: 'Dermatology', slug: 'dermatology' },
    ],
  },
  {
    name: 'Ayurveda',
    slug: 'ayurveda',
    subCategories: [
      { name: 'Ayurvedic Medicines', slug: 'ayurvedic-medicines' },
      { name: 'Herbal Supplements', slug: 'herbal-supplements' },
      { name: 'Ayurvedic Oils', slug: 'ayurvedic-oils' },
      { name: 'Churna & Powders', slug: 'churna-powders' },
    ],
  },
  {
    name: 'OTC Products',
    slug: 'otc-products',
    subCategories: [
      { name: 'Cold & Cough', slug: 'cold-cough' },
      { name: 'First Aid', slug: 'first-aid' },
      { name: 'Eye & Ear Care', slug: 'eye-ear-care' },
      { name: 'Oral Hygiene', slug: 'oral-hygiene' },
    ],
  },
  {
    name: 'Medical Devices',
    slug: 'medical-devices',
    subCategories: [
      { name: 'Surgical Instruments', slug: 'surgical-instruments' },
      { name: 'Diagnostic Devices', slug: 'diagnostic-devices' },
      { name: 'PPE & Safety', slug: 'ppe-safety' },
      { name: 'Disposables', slug: 'disposables' },
    ],
  },
  {
    name: 'Personal Care',
    slug: 'personal-care',
    subCategories: [
      { name: 'Skin Care', slug: 'skin-care' },
      { name: 'Hair Care', slug: 'hair-care' },
      { name: 'Baby Care', slug: 'baby-care' },
      { name: 'Hygiene Products', slug: 'hygiene-products' },
    ],
  },
  {
    name: 'Nutrition & Wellness',
    slug: 'nutrition',
    subCategories: [
      { name: 'Protein Supplements', slug: 'protein-supplements' },
      { name: 'Health Drinks', slug: 'health-drinks' },
      { name: 'Immunity Boosters', slug: 'immunity-boosters' },
      { name: 'Weight Management', slug: 'weight-management' },
    ],
  },
];
