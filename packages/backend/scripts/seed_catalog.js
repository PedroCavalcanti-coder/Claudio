'use strict';
/**
 * Seed curado dos catálogos clínicos (#9): medicamentos comuns + CID-10 comuns
 * da atenção primária. Idempotente (ON CONFLICT DO NOTHING). NÃO substitui a
 * carga oficial completa (ANVISA Dados Abertos / DATASUS) — esse é um passo de
 * dados externo à parte. Rodar: node scripts/seed_catalog.js
 */
require('dotenv').config();
const { Pool } = require('pg');

// [name, active_ingredient, form, controlled]
const MEDS = [
  ['Paracetamol', 'Paracetamol', 'comprimido 500mg', false],
  ['Paracetamol', 'Paracetamol', 'solução oral 200mg/mL', false],
  ['Dipirona', 'Dipirona sódica', 'comprimido 500mg', false],
  ['Dipirona', 'Dipirona sódica', 'solução oral 500mg/mL', false],
  ['Ibuprofeno', 'Ibuprofeno', 'comprimido 600mg', false],
  ['Ibuprofeno', 'Ibuprofeno', 'suspensão 50mg/mL', false],
  ['Nimesulida', 'Nimesulida', 'comprimido 100mg', false],
  ['Diclofenaco sódico', 'Diclofenaco sódico', 'comprimido 50mg', false],
  ['Naproxeno', 'Naproxeno', 'comprimido 500mg', false],
  ['Amoxicilina', 'Amoxicilina', 'cápsula 500mg', false],
  ['Amoxicilina + Clavulanato', 'Amoxicilina + Clavulanato de potássio', 'comprimido 500+125mg', false],
  ['Azitromicina', 'Azitromicina', 'comprimido 500mg', false],
  ['Cefalexina', 'Cefalexina', 'cápsula 500mg', false],
  ['Ciprofloxacino', 'Ciprofloxacino', 'comprimido 500mg', false],
  ['Sulfametoxazol + Trimetoprima', 'Sulfametoxazol + Trimetoprima', 'comprimido 400+80mg', false],
  ['Metronidazol', 'Metronidazol', 'comprimido 250mg', false],
  ['Nitrofurantoína', 'Nitrofurantoína', 'cápsula 100mg', false],
  ['Omeprazol', 'Omeprazol', 'cápsula 20mg', false],
  ['Pantoprazol', 'Pantoprazol', 'comprimido 40mg', false],
  ['Ranitidina', 'Ranitidina', 'comprimido 150mg', false],
  ['Domperidona', 'Domperidona', 'comprimido 10mg', false],
  ['Metoclopramida', 'Metoclopramida', 'comprimido 10mg', false],
  ['Ondansetrona', 'Ondansetrona', 'comprimido 4mg', false],
  ['Bromoprida', 'Bromoprida', 'comprimido 10mg', false],
  ['Losartana potássica', 'Losartana potássica', 'comprimido 50mg', false],
  ['Enalapril', 'Maleato de enalapril', 'comprimido 10mg', false],
  ['Captopril', 'Captopril', 'comprimido 25mg', false],
  ['Hidroclorotiazida', 'Hidroclorotiazida', 'comprimido 25mg', false],
  ['Furosemida', 'Furosemida', 'comprimido 40mg', false],
  ['Anlodipino', 'Besilato de anlodipino', 'comprimido 5mg', false],
  ['Atenolol', 'Atenolol', 'comprimido 50mg', false],
  ['Propranolol', 'Cloridrato de propranolol', 'comprimido 40mg', false],
  ['Metformina', 'Cloridrato de metformina', 'comprimido 850mg', false],
  ['Glibenclamida', 'Glibenclamida', 'comprimido 5mg', false],
  ['Gliclazida', 'Gliclazida', 'comprimido 30mg', false],
  ['Insulina NPH', 'Insulina humana NPH', 'suspensão injetável 100UI/mL', false],
  ['Insulina Regular', 'Insulina humana regular', 'solução injetável 100UI/mL', false],
  ['Sinvastatina', 'Sinvastatina', 'comprimido 20mg', false],
  ['Atorvastatina', 'Atorvastatina cálcica', 'comprimido 20mg', false],
  ['Levotiroxina', 'Levotiroxina sódica', 'comprimido 50mcg', false],
  ['Salbutamol', 'Sulfato de salbutamol', 'aerossol 100mcg/dose', false],
  ['Budesonida', 'Budesonida', 'cápsula inalante 200mcg', false],
  ['Prednisona', 'Prednisona', 'comprimido 20mg', false],
  ['Prednisolona', 'Prednisolona', 'solução oral 3mg/mL', false],
  ['Dexametasona', 'Dexametasona', 'comprimido 4mg', false],
  ['Loratadina', 'Loratadina', 'comprimido 10mg', false],
  ['Dexclorfeniramina', 'Maleato de dexclorfeniramina', 'comprimido 2mg', false],
  ['Cetirizina', 'Cloridrato de cetirizina', 'comprimido 10mg', false],
  ['Hioscina (escopolamina)', 'Butilbrometo de escopolamina', 'comprimido 10mg', false],
  ['Sais para reidratação oral', 'Sais para reidratação oral', 'pó para solução', false],
  ['Ácido fólico', 'Ácido fólico', 'comprimido 5mg', false],
  ['Sulfato ferroso', 'Sulfato ferroso', 'comprimido 40mg Fe', false],
  ['Albendazol', 'Albendazol', 'comprimido 400mg', false],
  ['Ivermectina', 'Ivermectina', 'comprimido 6mg', false],
  ['Fluconazol', 'Fluconazol', 'cápsula 150mg', false],
  ['Aciclovir', 'Aciclovir', 'comprimido 200mg', false],
  ['Ácido acetilsalicílico', 'Ácido acetilsalicílico', 'comprimido 100mg', false],
  // Controlados (P344) — entram com flag controlled = true
  ['Clonazepam', 'Clonazepam', 'comprimido 2mg', true],
  ['Diazepam', 'Diazepam', 'comprimido 10mg', true],
  ['Alprazolam', 'Alprazolam', 'comprimido 1mg', true],
  ['Amitriptilina', 'Cloridrato de amitriptilina', 'comprimido 25mg', true],
  ['Fluoxetina', 'Cloridrato de fluoxetina', 'cápsula 20mg', true],
  ['Sertralina', 'Cloridrato de sertralina', 'comprimido 50mg', true],
  ['Codeína + Paracetamol', 'Fosfato de codeína + Paracetamol', 'comprimido 30+500mg', true],
  ['Tramadol', 'Cloridrato de tramadol', 'comprimido 50mg', true],
  ['Morfina', 'Sulfato de morfina', 'comprimido 10mg', true],
  ['Fenobarbital', 'Fenobarbital', 'comprimido 100mg', true],
];

// [code, description, category]
const CIDS = [
  ['A09', 'Diarreia e gastroenterite de origem infecciosa presumível', 'Doenças infecciosas'],
  ['B34.9', 'Infecção viral não especificada', 'Doenças infecciosas'],
  ['E11', 'Diabetes mellitus tipo 2', 'Endócrinas'],
  ['E11.9', 'Diabetes mellitus tipo 2 sem complicações', 'Endócrinas'],
  ['E78.5', 'Hiperlipidemia não especificada', 'Endócrinas'],
  ['E03.9', 'Hipotireoidismo não especificado', 'Endócrinas'],
  ['E66.9', 'Obesidade não especificada', 'Endócrinas'],
  ['F32.9', 'Episódio depressivo não especificado', 'Mentais'],
  ['F41.1', 'Ansiedade generalizada', 'Mentais'],
  ['F41.9', 'Transtorno ansioso não especificado', 'Mentais'],
  ['G43.9', 'Enxaqueca não especificada', 'Sistema nervoso'],
  ['H10.9', 'Conjuntivite não especificada', 'Olho'],
  ['H66.9', 'Otite média não especificada', 'Ouvido'],
  ['I10', 'Hipertensão essencial (primária)', 'Circulatórias'],
  ['I20.9', 'Angina pectoris não especificada', 'Circulatórias'],
  ['J00', 'Nasofaringite aguda (resfriado comum)', 'Respiratórias'],
  ['J02.9', 'Faringite aguda não especificada', 'Respiratórias'],
  ['J03.9', 'Amigdalite aguda não especificada', 'Respiratórias'],
  ['J06.9', 'Infecção aguda das vias aéreas superiores não especificada', 'Respiratórias'],
  ['J11', 'Influenza (gripe) devida a vírus não identificado', 'Respiratórias'],
  ['J18.9', 'Pneumonia não especificada', 'Respiratórias'],
  ['J20.9', 'Bronquite aguda não especificada', 'Respiratórias'],
  ['J45.9', 'Asma não especificada', 'Respiratórias'],
  ['K021', 'Cárie da dentina', 'Digestivas'],
  ['K21.9', 'Doença de refluxo gastroesofágico sem esofagite', 'Digestivas'],
  ['K29.7', 'Gastrite não especificada', 'Digestivas'],
  ['K30', 'Dispepsia funcional', 'Digestivas'],
  ['K59.0', 'Constipação', 'Digestivas'],
  ['L23.9', 'Dermatite de contato alérgica de causa não especificada', 'Pele'],
  ['L30.9', 'Dermatite não especificada', 'Pele'],
  ['M54.5', 'Dor lombar baixa', 'Musculoesqueléticas'],
  ['M54.9', 'Dorsalgia não especificada', 'Musculoesqueléticas'],
  ['M79.1', 'Mialgia', 'Musculoesqueléticas'],
  ['N30.0', 'Cistite aguda', 'Geniturinárias'],
  ['N39.0', 'Infecção do trato urinário de localização não especificada', 'Geniturinárias'],
  ['R05', 'Tosse', 'Sintomas e sinais'],
  ['R10.4', 'Dor abdominal, outras e não especificadas', 'Sintomas e sinais'],
  ['R42', 'Tontura e instabilidade', 'Sintomas e sinais'],
  ['R50.9', 'Febre não especificada', 'Sintomas e sinais'],
  ['R51', 'Cefaleia', 'Sintomas e sinais'],
  ['Z00.0', 'Exame médico geral', 'Fatores que influenciam a saúde'],
  ['Z23', 'Necessidade de imunização contra doença bacteriana isolada', 'Fatores que influenciam a saúde'],
];

// [ingredient_a, ingredient_b, severity, note] — princípios ativos em minúsculas.
// Pares normalizados (a<=b) na inserção. Base curada (sem API BR gratuita).
const INTERACTIONS = [
  ['varfarina', 'ácido acetilsalicílico', 'severe', 'Risco aumentado de sangramento.'],
  ['varfarina', 'dipirona sódica', 'severe', 'Potencializa efeito anticoagulante — risco de sangramento.'],
  ['varfarina', 'fluconazol', 'severe', 'Fluconazol aumenta o efeito da varfarina (INR).'],
  ['varfarina', 'sulfametoxazol + trimetoprima', 'severe', 'Potencializa anticoagulação — sangramento.'],
  ['ácido acetilsalicílico', 'ibuprofeno', 'moderate', 'AINE reduz o efeito antiagregante do AAS.'],
  ['ibuprofeno', 'enalapril', 'moderate', 'AINE reduz efeito anti-hipertensivo e risco renal.'],
  ['ibuprofeno', 'maleato de enalapril', 'moderate', 'AINE reduz efeito anti-hipertensivo e risco renal.'],
  ['ibuprofeno', 'losartana potássica', 'moderate', 'AINE reduz efeito anti-hipertensivo e risco renal.'],
  ['ibuprofeno', 'furosemida', 'moderate', 'AINE reduz efeito diurético.'],
  ['diclofenaco sódico', 'maleato de enalapril', 'moderate', 'AINE + IECA: risco renal e hipertensão.'],
  ['captopril', 'cloridrato de amitriptilina', 'mild', 'Possível hipotensão.'],
  ['fluoxetina', 'cloridrato de tramadol', 'severe', 'Risco de síndrome serotoninérgica.'],
  ['cloridrato de sertralina', 'cloridrato de tramadol', 'severe', 'Risco de síndrome serotoninérgica.'],
  ['cloridrato de amitriptilina', 'cloridrato de tramadol', 'severe', 'Reduz limiar convulsivo / serotoninérgica.'],
  ['cloridrato de fluoxetina', 'cloridrato de tramadol', 'severe', 'Risco de síndrome serotoninérgica.'],
  ['clonazepam', 'sulfato de morfina', 'severe', 'Depressão respiratória / sedação aditiva.'],
  ['diazepam', 'sulfato de morfina', 'severe', 'Depressão respiratória / sedação aditiva.'],
  ['clonazepam', 'cloridrato de tramadol', 'moderate', 'Sedação aditiva / depressão do SNC.'],
  ['azitromicina', 'varfarina', 'moderate', 'Pode aumentar o efeito anticoagulante.'],
  ['claritromicina', 'sinvastatina', 'severe', 'Risco de rabdomiólise.'],
  ['sinvastatina', 'fluconazol', 'moderate', 'Aumenta exposição à estatina — miopatia.'],
  ['metformina', 'furosemida', 'mild', 'Ajuste glicêmico pode ser necessário.'],
  ['glibenclamida', 'sulfametoxazol + trimetoprima', 'moderate', 'Risco de hipoglicemia.'],
  ['espironolactona', 'losartana potássica', 'severe', 'Risco de hipercalemia.'],
  ['hidroclorotiazida', 'carbonato de lítio', 'severe', 'Aumenta níveis de lítio — toxicidade.'],
  ['cloridrato de propranolol', 'salbutamol', 'moderate', 'Betabloqueador antagoniza broncodilatador.'],
  ['digoxina', 'furosemida', 'moderate', 'Hipocalemia aumenta toxicidade da digoxina.'],
  ['omeprazol', 'clopidogrel', 'moderate', 'Reduz a ativação do clopidogrel.'],
  ['codeína + fosfato', 'fluoxetina', 'moderate', 'Reduz a conversão da codeína (menor analgesia).'],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Tabela (idempotente — caso o schema não tenha sido reaplicado).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ris.medications_catalog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(200) NOT NULL, active_ingredient VARCHAR(200), form VARCHAR(80),
        controlled BOOLEAN NOT NULL DEFAULT FALSE, anvisa_reg VARCHAR(40),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_med_name_form UNIQUE (name, form));
    `);

    let med = 0;
    for (const [name, ai, form, ctrl] of MEDS) {
      const r = await pool.query(
        `INSERT INTO ris.medications_catalog (name, active_ingredient, form, controlled)
         VALUES ($1,$2,$3,$4) ON CONFLICT (name, form) DO NOTHING`,
        [name, ai, form, ctrl]);
      med += r.rowCount;
    }
    let cid = 0;
    for (const [code, desc, cat] of CIDS) {
      const r = await pool.query(
        `INSERT INTO ris.cid10 (code, description, category)
         VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`, [code, desc, cat]);
      cid += r.rowCount;
    }
    // Interações (#1 Nível 4) — tabela idempotente + pares normalizados a<=b.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ris.drug_interactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ingredient_a VARCHAR(200) NOT NULL, ingredient_b VARCHAR(200) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'moderate', note TEXT,
        CONSTRAINT uq_interaction UNIQUE (ingredient_a, ingredient_b),
        CONSTRAINT chk_interaction_order CHECK (ingredient_a <= ingredient_b));
    `);
    let inter = 0;
    for (const [ra, rb, sev, note] of INTERACTIONS) {
      const a = ra.toLowerCase().trim(), b = rb.toLowerCase().trim();
      const [x, y] = a <= b ? [a, b] : [b, a];
      const r = await pool.query(
        `INSERT INTO ris.drug_interactions (ingredient_a, ingredient_b, severity, note)
         VALUES ($1,$2,$3,$4) ON CONFLICT (ingredient_a, ingredient_b) DO NOTHING`, [x, y, sev, note]);
      inter += r.rowCount;
    }

    const medTotal = (await pool.query(`SELECT count(*) n FROM ris.medications_catalog`)).rows[0].n;
    const cidTotal = (await pool.query(`SELECT count(*) n FROM ris.cid10`)).rows[0].n;
    const intTotal = (await pool.query(`SELECT count(*) n FROM ris.drug_interactions`)).rows[0].n;
    console.log(`Seed OK — medicamentos +${med} (total ${medTotal}); CID-10 +${cid} (total ${cidTotal}); interações +${inter} (total ${intTotal}).`);
  } catch (e) {
    console.error('FALHA:', e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
