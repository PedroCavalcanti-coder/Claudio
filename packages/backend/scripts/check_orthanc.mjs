// test-orthanc-connection.js
// Verifica a conexão do Node.js com o Orthanc via REST API

import axios from 'axios';

// Configurações do Orthanc
const ORTHANC_URL = 'http://localhost:8042';
// Se tiver autenticação básica ativada no Orthanc:
const AUTH = { username: 'orthanc', password: 'orthanc' };
export const axiosConfig = { auth: AUTH };

// Tempo máximo de resposta (ms)
const TIMEOUT = 5000;

async function testConnection() {
  console.log(`🔌 Testando conexão com Orthanc em ${ORTHANC_URL}...`);

  try {
    // 1. Verificar se o Orthanc está respondendo (endpoint /system)
    const systemResponse = await axios.get(`${ORTHANC_URL}/system`, { timeout: TIMEOUT });
    console.log('✅ Orthanc está online!');
    console.log(`   Versão: ${systemResponse.data.Version}`);
    console.log(`   Nome: ${systemResponse.data.Name}`);

    // 2. Listar estudos (deve retornar array, mesmo vazio)
    const studiesResponse = await axios.get(`${ORTHANC_URL}/studies`, { timeout: TIMEOUT });
    const studies = studiesResponse.data;
    console.log(`📊 Total de estudos encontrados: ${studies.length}`);
    
    if (studies.length > 0) {
      console.log('   IDs dos estudos:', studies.slice(0, 5)); // mostra até 5
      // Opcional: pegar detalhes do primeiro estudo
      const firstStudyId = studies[0];
      const studyDetails = await axios.get(`${ORTHANC_URL}/studies/${firstStudyId}`, { timeout: TIMEOUT });
      console.log(`   Exemplo - Estudo ${firstStudyId}:`);
      console.log(`     Paciente: ${studyDetails.data.PatientMainDicomTags.PatientName || 'N/A'}`);
      console.log(`     Data: ${studyDetails.data.MainDicomTags.StudyDate || 'N/A'}`);
      console.log(`     Descrição: ${studyDetails.data.MainDicomTags.StudyDescription || 'N/A'}`);
    } else {
      console.log('   (Nenhum estudo armazenado ainda)');
    }

    // 3. Verificar estatísticas gerais
    const statsResponse = await axios.get(`${ORTHANC_URL}/statistics`, { timeout: TIMEOUT });
    console.log(`📈 Estatísticas:`);
    console.log(`   Pacientes: ${statsResponse.data.CountPatients}`);
    console.log(`   Estudos: ${statsResponse.data.CountStudies}`);
    console.log(`   Séries: ${statsResponse.data.CountSeries}`);
    console.log(`   Instâncias: ${statsResponse.data.CountInstances}`);
    console.log(`   Tamanho total: ${(statsResponse.data.TotalDiskSizeMB / 1024).toFixed(2)} GB`);

    console.log('\n🎉 Conexão bem-sucedida! Seu Node.js está se comunicando com o Orthanc.');
  } catch (error) {
    console.error('❌ Falha na conexão com Orthanc:');
    if (error.code === 'ECONNREFUSED') {
      console.error(`   Não foi possível conectar a ${ORTHANC_URL}. Verifique se o Orthanc está rodando (docker ps) e se a porta está exposta.`);
    } else if (error.response) {
      console.error(`   HTTP ${error.response.status}: ${error.response.statusText}`);
      console.error(`   Detalhe: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`   Sem resposta do servidor (timeout ou rede): ${error.message}`);
    } else {
      console.error(`   Erro: ${error.message}`);
    }
    process.exit(1);
  }
}

// Executar
testConnection();