const common = require('./utils/common.js')
const SLEEP_INTERVAL = process.env.SLEEP_INTERVAL || 2000
const PRIVATE_KEY_FILE_NAME = process.env.PRIVATE_KEY_FILE || './caller/caller_private_key'
const CallerJSON = require('./caller/build/contracts/CallerContract.json')
const OracleJSON = require('./oracle/build/contracts/EthPriceOracle.json')

async function getCallerContract (web3js) { // hàm trả về một hợp đồng trừu tượng của callerContract
  const networkId = await web3js.eth.net.getId()
  return new web3js.eth.Contract(CallerJSON.abi, CallerJSON.networks[networkId].address)
}

async function filterEvents (callerContract) { // hàm lọc các sư kiện trong hợp đồng callerContract 
  callerContract.events.PriceUpdatedEvent({ filter: { } }, async (err, event) => { // lắng nghe sự kiện update giá
    if (err) console.error('Error on event', err) //nếu có lỗi thì console.error caí lỗi ý ra
    console.log('* New PriceUpdated event. ethPrice: ' + event.returnValues.ethPrice) //nếu không có lỗi sẽ hiện ra giá mới nhất bằng event.returnValues.ethPrice
  })
  callerContract.events.ReceivedNewRequestIdEvent({ filter: { } }, async (err, event) => { //lắng nghe sự kiện ReceivedNewRequestIdEvent
    if (err) console.error('Error on event', err)
  })
}

async function init () { // hàm này giúp chúng ta triển khai lên mạng Extdev TestNet
  const { ownerAddress, web3js, client } = common.loadAccount(PRIVATE_KEY_FILE_NAME)
  const callerContract = await getCallerContract(web3js)
  filterEvents(callerContract)
  return { callerContract, ownerAddress, client, web3js }
}

(async () => { // khởi tạo hợp đồng callerContrac
  const { callerContract, ownerAddress, client, web3js } = await init()
  process.on( 'SIGINT', () => {
    console.log('Calling client.disconnect()')
    client.disconnect();
    process.exit( );
  })
  const networkId = await web3js.eth.net.getId()
  const oracleAddress =  OracleJSON.networks[networkId].address
  await callerContract.methods.setOracleInstanceAddress(oracleAddress).send({ from: ownerAddress })
  setInterval( async () => {
    await callerContract.methods.updateEthPrice().send({ from: ownerAddress })
  }, SLEEP_INTERVAL);
})()
