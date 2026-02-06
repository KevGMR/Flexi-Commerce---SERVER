const axios = require("axios");
const { getAccessToken } = require("./shopifyAuth");

const domain = process.env.DOMAIN;
const apiVersion = process.env.SHOPIFY_API_VERSION;

const url = `https://${domain}.myshopify.com/admin/api/${apiVersion}/graphql.json`;

async function shopifyGraphQL(query, variables, operationName) {
  try {
    const accessToken = await getAccessToken();

    const { data } = await axios.post(
      url,
      {
        variables,
        query,
        operationName,
      },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const cost = data.extensions?.cost;
    if (!cost) return data;

    const queryCost = cost.actualQueryCost;
    const available = cost.throttleStatus.currentlyAvailable;
    const restoreRate = cost.throttleStatus.restoreRate;
    const restoreTime = Math.ceil(queryCost / restoreRate) * 2000;

    if (available - queryCost < 0) {
      await new Promise(resolve => setTimeout(resolve, restoreTime));
      return shopifyGraphQL(query, variables, operationName);
    }

    return data;

  } catch (error) {
    console.error({ graphql: error?.response?.data || error });
    throw error;
  }
}

module.exports = { shopifyGraphQL };
