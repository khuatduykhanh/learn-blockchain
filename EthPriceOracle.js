const axios = require('axios')
const BN = require('bn.js')
const common = require('./utils/common.js')
const SLEEP_INTERVAL = process.env.SLEEP_INTERVAL || 2000
const PRIVATE_KEY_FILE_NAME = process.env.PRIVATE_KEY_FILE || './oracle/oracle_private_key'
const CHUNK_SIZE = process.env.CHUNK_SIZE || 3
const MAX_RETRIES = process.env.MAX_RETRIES || 5
const OracleJSON = require('./oracle/build/contracts/EthPriceOracle.json')
var pendingRequests = []

async function getOracleContract (web3js) { //hàm này giúp khởi tạo hợp đồng OracleContract
  const networkId = await web3js.eth.net.getId() // await web3js.eth.net.getId() giúp chúng ta lấy được id khi hàm được triển khai trên một mạng cụ thể
  return new web3js.eth.Contract(OracleJSON.abi, OracleJSON.networks[networkId].address) //hàm này trả về một hợp đồng trừu tượng của OracleContract 
  // OracleJSON.abi tham số này sẽ trả về abi của hợp đồng OracleContract, còn OracleJSON.networks[networkId].address sẽ trả về địa chỉ của hợp đồng được triên khai trên một mạng cụ thể
}
async function retrieveLatestEthPrice () {// hàm này sẽ trả về giá mới nhất của eth
  const resp = await axios({
    url: 'https://api.binance.com/api/v3/ticker/price',
    params: {
      symbol: 'ETHUSDT'
    },
    method: 'get'
  })
  return resp.data.price
}
async function filterEvents (oracleContract, web3js) { //hàm này kích hoạt các sự kiện trong hợp đồng OraclrContract nhận vào 2 tham số oracleContract và web3j
  oracleContract.events.GetLatestEthPriceEvent(async (err, event) => { //kích hoạt sự kiện GetLatestEthPriceEvent trong OracleContract trả về 2 giá trị đó là err(lỗi) event(giá trị của 2 sự kiện khi được kích hoạt)
    if (err) { // nếu có lỗi sẽ thông báo và trả về lỗi
      console.error('Error on event', err)
      return 
    }
    await addRequestToQueue(event) //nếu không có lỗi thì sẽ gọi hàm addRequestToQueue và truyềnt tham số event
  })

  oracleContract.events.SetLatestEthPriceEvent(async (err, event) => { //kích hoạt sự kiện SetLatestEthPriceEvent trong OracleContract
    if (err) console.error('Error on event', err)
    // Do something
  })
}

async function addRequestToQueue (event) { //hàm này sẽ thêm sự kiện GetLatestEthPriceEvent và môt mảng đối tượng có tên pendingRequests
  const callerAddress = event.returnValues.callerAddress // lấy ra giá trị callAddress trong event bằng event.returnValues.callerAddress
  const id = event.returnValues.id // lấy ra giá trị id trong event bằng event.returnValues.id
  pendingRequests.push({ callerAddress, id }) // thêm đối 2 đối tượng này vào mảng pendingRequests
}
async function processQueue (oracleContract, ownerAddress) { // do js là đơn luồng nên tất cả các hành động khác sẽ bị chặn cho đến khi quá trình xử lý mảng kết thúc nên chúng ta phải chia nhỏ mảng ra để truy cập từ từ
  let processedRequests = 0 // gán processedRequests(yêu cầu đã xử lý) bằng 0
  while (pendingRequests.length > 0 && processedRequests < CHUNK_SIZE) { //xử dụng vòng lặp while để kiểm tra độ dài mảng phải lớn hơn 0 và processedRequests phải nhỏ hơn 3 (xử lý 3 đối tượng một)
    const req = pendingRequests.shift() //shift xoá bỏ phần tử đầu tiên của mảng pendingRequests và lấy phần tử đó gán cho req
    await processRequest(oracleContract, ownerAddress, req.id, req.callerAddress) // thực thi hàm processRequest(yêu cầu xử lý) truyền vào 4 đối số oracleContract, ownerAddress, req.id, req.callerAddress
    processedRequests++ // h sẽ tăng processedRequsets(yêu cầu đã xử lý) lên 1
  }
}

async function processRequest (oracleContract, ownerAddress, id, callerAddress) { // hàm này sẽ xử lý yêu cầu trong mảng pendingRequests
  let retries = 0 // khai báo số lần thử(đề phòng khi đang gọi hàm update giá mà bị mất mạng và yêu cầu sẽ không thành công dẫn đến hợp đồng callerContract sẽ phải khởi động lại toàn bộ kể khi mất mạng vài s )
  while (retries < MAX_RETRIES) { // dùng vòng lặp while để cho phép yêu cầu này được chạy lại 5 lần
    try { // trong try có thể xảy ra lỗi khi mất mạng trong try có lỗi thì catch mới chạy
      const ethPrice = await retrieveLatestEthPrice() //gọi hàm retrieveLatestEthPrice() hàm này sẽ trả về giá mới nhất của eth
      await setLatestEthPrice(oracleContract, callerAddress, ownerAddress, ethPrice, id) // gọi hàm setLatestEthPrice để thiết lập đặt giá mới nhất
      return // nếu mà trong try không có lỗi hàm sẽ return luôn và vòng lặp while sẽ dừng tại đây
    } catch (error) { // nếu trong try có lỗi sẽ thực hiện bên trong hàm này
      if (retries === MAX_RETRIES - 1) { nếu retries = 4 (chạy thử đến lần thứ 5 mà vẫn sai)
        await setLatestEthPrice(oracleContract, callerAddress, ownerAddress, '0', id) //gọi hàm setLatestEthPrice và cho giá của eth bằng 0
        return // trả về cho hàm
      }
      retries++ // mỗi lần gặp lỗi sẽ tăng retries lên 1
    }
  }
}

async function setLatestEthPrice (oracleContract, callerAddress, ownerAddress, ethPrice, id) { // hàm này sẽ thiết lập giá mới nhất của eth
  // do trong máy ảo Ethereum không hỗi trợ dấu phảy động nên chúng ta phải sử dụng thư viện bn.js 
  ethPrice = ethPrice.replace('.', '') // sẽ xoá bỏ dấu phảy động vd 123.13000 sẽ thành 12313000
  const multiplier = new BN(10**10, 10)// định nghĩa phép nhân 10mũ 10 bằng bn
  const ethPriceInt = (new BN(parseInt(ethPrice), 10)).mul(multiplier) //nhân giá của ethPrice với 10 mũ 10
  const idInt = new BN(parseInt(id)) // chuyển id sang dạng bn
  try {
    await oracleContract.methods.setLatestEthPrice(ethPriceInt.toString(), callerAddress, idInt.toString()).send({ from: ownerAddress })
    // try cập vào hàm setLatestEthPrice trong hợp đồng EthPriceOracle 
  } catch (error) { //nếu truy cập không thành công sẽ có lỗi và thông báo lỗi
    console.log('Error encountered while calling setLatestEthPrice.')
    // Do some error handling
  }
}

async function init () { //hàm này giúp chúng ta triển khai lên mạng Extdev TestNet và chạy thử oracle
  const { ownerAddress, web3js, client } = common.loadAccount(PRIVATE_KEY_FILE_NAME) // common.loadAccount(PRIVATE_KEY_FILE_NAME) sẽ trả về 3 giá trị 
  //ownerAddress để chỉ định địa chỉ gửi giao dịch, client là một đối tượng mà ứng dụng sử dụng để tương tác với Extdev TestNet và trả về web3js
  const oracleContract = await getOracleContract(web3js)// khởi tạo hợp đồng OracleContract 
  filterEvents(oracleContract, web3js) // khởi tạo các sự kiện
  return { oracleContract, ownerAddress, client } //hàm này trả về oracleContract(hợp đồng OracleContract) ownerAddress và client
}

(async () => { //hàm này sẽ khởi tạo toàn bộ hợp đồng Oracle
  const { oracleContract, ownerAddress, client } = await init() //chạy hàm init và gán 3 đối số trả về lần lượt 
  process.on( 'SIGINT', () => {
    console.log('Calling client.disconnect()')
    client.disconnect()
    process.exit( )
  })
  setInterval(async () => {
    await processQueue(oracleContract, ownerAddress)
  }, SLEEP_INTERVAL)
})() 
