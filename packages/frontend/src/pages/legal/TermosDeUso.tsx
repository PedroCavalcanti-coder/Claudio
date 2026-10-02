import { ShieldCheck } from 'lucide-react';

// Conteúdo modelo: o município deve revisar com jurídico/DPO antes do piloto (ver docs/plano-piloto.md)
export default function TermosDeUso() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-950)', color: 'var(--sl-200)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} className="animate-fade-in">
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 22, color: 'var(--sl-100)' }}>Termos de Uso e Política de Privacidade</h1>
            <p style={{ fontSize: 13, color: 'var(--sl-500)' }}>Sistema RIS/PACS com Prontuário Eletrônico — Rede Municipal de Saúde</p>
          </div>
        </header>

        <p style={{ fontSize: 12, color: 'var(--sl-600)', marginBottom: 20 }}>
          Documento modelo — o município deve revisar com o setor jurídico e o
          Encarregado de Dados (DPO) antes da operação. Substituir “[Município]”.
        </p>

        <Section n="1" title="Objeto">
          Este documento regula o uso do sistema clínico da rede municipal de saúde
          de <b>[Município]</b>, que reúne agendamento, exames de imagem, prontuário
          eletrônico, prescrição, teleconsulta e o portal do paciente.
        </Section>

        <Section n="2" title="Tratamento de dados pessoais (LGPD)">
          O sistema trata dados pessoais e <b>dados sensíveis de saúde</b> com base
          na <b>Lei nº 13.709/2018 (LGPD)</b>. A base legal é a <b>tutela da saúde</b>
          (art. 11, II, “a”/“f”) e a execução de políticas públicas de saúde. Dados
          são usados <b>apenas</b> para prestar e documentar o atendimento, e são
          cifrados em repouso. O controlador é a Secretaria Municipal de Saúde de
          [Município]; dúvidas e solicitações ao Encarregado (DPO): <b>[email/telefone do DPO]</b>.
        </Section>

        <Section n="3" title="Direitos do titular">
          O paciente pode solicitar confirmação de tratamento, acesso, correção,
          portabilidade e informações sobre o uso dos seus dados, nos termos da LGPD.
          O sistema mantém registro de acessos (auditoria) e oferece exportação de
          dados do paciente mediante solicitação à unidade.
        </Section>

        <Section n="4" title="Portal do paciente e conta de acesso">
          O acesso ao portal é pessoal e intransferível, feito por CPF e senha. A
          senha inicial é entregue pela unidade e deve ser trocada no primeiro acesso.
          O titular é responsável por manter a confidencialidade da sua senha.
        </Section>

        <Section n="5" title="Uso por profissionais">
          O acesso do profissional é individual e vinculado ao seu perfil e unidade.
          É vedado compartilhar credenciais. Todo acesso a dado clínico é auditado; o
          acesso fora de vínculo (emergência/“quebra de sigilo”) exige justificativa e
          é registrado. O uso indevido sujeita às sanções administrativas e legais.
        </Section>

        <Section n="6" title="Teleconsulta">
          A teleconsulta ocorre por vídeo ponto-a-ponto. Não há gravação da chamada
          pelo sistema. O paciente deve estar em ambiente privado e com conexão adequada.
        </Section>

        <Section n="7" title="Segurança e limitações">
          São adotadas medidas técnicas (cifragem de dados pessoais, controle de
          acesso por perfil, HTTPS, auditoria e backup). Nenhum sistema é isento de
          risco; incidentes de segurança relevantes serão comunicados conforme a LGPD.
        </Section>

        <Section n="8" title="Aceite">
          Ao marcar o aceite no cadastro/criação de conta ou no check-in, o titular
          (ou o profissional, no seu âmbito) declara ter lido e concordado com estes
          Termos e com a Política de Privacidade.
        </Section>

        <p style={{ fontSize: 12, color: 'var(--sl-600)', marginTop: 24, borderTop: '1px solid var(--navy-700)', paddingTop: 12 }}>
          Versão modelo · atualizar data e responsável na implantação.
        </p>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 15, color: 'var(--sl-100)', marginBottom: 6 }}>{n}. {title}</h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--sl-300)' }}>{children}</p>
    </section>
  );
}
