'use strict';

const axios = require('axios');
const { consultarIAT } = require('./src/providers/iat');
const { consultarIbama } = require('./src/providers/ibama');
const { consultarPNLA } = require('./src/providers/pnla');
const { consultarOrgaoMunicipal } = require('./src/data/municipios-parana');

const { validarCNPJ } = require('./src/utils/cnpj');

async function consultarCadastro(cnpj) {
  try {
    const response = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      timeout: 8000, headers: { Accept: 'application/json' },
    });
    return {
      sucesso: true,
      empresa: {
        razao_social: response.data?.razao_social || null,
        nome_fantasia: response.data?.nome_fantasia || null,
        cnpj,
        situacao_cadastral: response.data?.descricao_situacao_cadastral || null,
        municipio: response.data?.municipio || null,
        uf: response.data?.uf || null,
      },
      fonte: 'Brasil API',
    };
  } catch (_error) {
    return { sucesso: false, empresa: null, fonte: null, aviso: 'Não foi possível consultar os dados cadastrais na Brasil API.' };
  }
}

async function cacarLicencasPorCNPJ(cnpjInformado, municipioInformado) {
  const cnpj = String(cnpjInformado).replace(/\D/g, '');
  if (!validarCNPJ(cnpj)) {
    const error = new Error('CNPJ inválido.');
    error.statusCode = 400;
    throw error;
  }

  const cadastro = await consultarCadastro(cnpj);
  const municipio = municipioInformado || cadastro.empresa?.municipio || null;
  const [iat, ibama, pnla] = await Promise.all([
    consultarIAT(cnpj, municipio),
    consultarIbama(cnpj, municipio),
    consultarPNLA(cnpj, municipio),
  ]);
  const competenciaMunicipal = consultarOrgaoMunicipal(municipio);

  return {
    sucesso: true,
    consulta_cadastral: cadastro.sucesso,
    empresa: cadastro.empresa,
    municipio_considerado: municipio,
    total: ibama.resultados?.length || 0,
    licencas: ibama.resultados || [],
    fontes: { iat, ibama, pnla, municipal: competenciaMunicipal },
    aviso: 'A consulta municipal e a consulta do IAT/PNLA são encaminhamentos para portais oficiais quando não há API pública documentada. Ausência de resultado em uma base não comprova inexistência de licença. Valide sempre o documento e a competência do órgão licenciador.',
    fonte_cadastral: cadastro.fonte,
    consultado_em: new Date().toISOString(),
  };
}

module.exports = { cacarLicencasPorCNPJ, validarCNPJ, consultarCadastro };
