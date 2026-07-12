export interface AirportInfo {
  code: string
  city: string
  name: string
}

/** Suggestion catalog — not exhaustive (unknown IATA codes are still accepted). */
export const AIRPORTS: AirportInfo[] = [
  // US East
  { code: 'WAS', city: 'Washington DC', name: 'All Washington DC airports' },
  { code: 'IAD', city: 'Washington DC', name: 'Dulles' },
  { code: 'DCA', city: 'Washington DC', name: 'Reagan National' },
  { code: 'BWI', city: 'Baltimore', name: 'Baltimore/Washington' },
  { code: 'NYC', city: 'New York', name: 'All New York airports' },
  { code: 'JFK', city: 'New York', name: 'John F. Kennedy' },
  { code: 'EWR', city: 'Newark', name: 'Newark Liberty' },
  { code: 'LGA', city: 'New York', name: 'LaGuardia' },
  { code: 'BOS', city: 'Boston', name: 'Logan' },
  { code: 'MIA', city: 'Miami', name: 'Miami International' },
  { code: 'FLL', city: 'Fort Lauderdale', name: 'Fort Lauderdale–Hollywood' },
  { code: 'MCO', city: 'Orlando', name: 'Orlando International' },
  { code: 'TPA', city: 'Tampa', name: 'Tampa International' },
  { code: 'ATL', city: 'Atlanta', name: 'Hartsfield–Jackson' },
  { code: 'CLT', city: 'Charlotte', name: 'Charlotte Douglas' },
  { code: 'PHL', city: 'Philadelphia', name: 'Philadelphia International' },
  { code: 'DTW', city: 'Detroit', name: 'Detroit Metro' },
  { code: 'PIT', city: 'Pittsburgh', name: 'Pittsburgh International' },
  { code: 'RDU', city: 'Raleigh–Durham', name: 'Raleigh–Durham' },
  // US Central / Mountain
  { code: 'ORD', city: 'Chicago', name: "O'Hare" },
  { code: 'MDW', city: 'Chicago', name: 'Midway' },
  { code: 'DFW', city: 'Dallas–Fort Worth', name: 'DFW International' },
  { code: 'IAH', city: 'Houston', name: 'George Bush Intercontinental' },
  { code: 'AUS', city: 'Austin', name: 'Austin-Bergstrom' },
  { code: 'MSP', city: 'Minneapolis', name: 'Minneapolis–St. Paul' },
  { code: 'STL', city: 'St. Louis', name: 'Lambert' },
  { code: 'BNA', city: 'Nashville', name: 'Nashville International' },
  { code: 'DEN', city: 'Denver', name: 'Denver International' },
  { code: 'SLC', city: 'Salt Lake City', name: 'Salt Lake City International' },
  { code: 'PHX', city: 'Phoenix', name: 'Sky Harbor' },
  // US West
  { code: 'SEA', city: 'Seattle', name: 'Seattle–Tacoma' },
  { code: 'PDX', city: 'Portland', name: 'Portland International' },
  { code: 'SFO', city: 'San Francisco', name: 'San Francisco International' },
  { code: 'SJC', city: 'San Jose', name: 'Mineta San Jose' },
  { code: 'OAK', city: 'Oakland', name: 'Oakland International' },
  { code: 'LAX', city: 'Los Angeles', name: 'Los Angeles International' },
  { code: 'SAN', city: 'San Diego', name: 'San Diego International' },
  { code: 'LAS', city: 'Las Vegas', name: 'Harry Reid' },
  { code: 'HNL', city: 'Honolulu', name: 'Daniel K. Inouye' },
  // Canada
  { code: 'YVR', city: 'Vancouver', name: 'Vancouver International' },
  { code: 'YYZ', city: 'Toronto', name: 'Pearson' },
  { code: 'YUL', city: 'Montreal', name: 'Trudeau' },
  // China
  { code: 'PEK', city: 'Beijing', name: 'Capital' },
  { code: 'PKX', city: 'Beijing', name: 'Daxing' },
  { code: 'PVG', city: 'Shanghai', name: 'Pudong' },
  { code: 'SHA', city: 'Shanghai', name: 'Hongqiao' },
  { code: 'CTU', city: 'Chengdu', name: 'Shuangliu' },
  { code: 'TFU', city: 'Chengdu', name: 'Tianfu' },
  { code: 'CKG', city: 'Chongqing', name: 'Jiangbei' },
  { code: 'CAN', city: 'Guangzhou', name: 'Baiyun' },
  { code: 'SZX', city: 'Shenzhen', name: "Bao'an" },
  { code: 'HGH', city: 'Hangzhou', name: 'Xiaoshan' },
  { code: 'XIY', city: "Xi'an", name: 'Xianyang' },
  { code: 'KMG', city: 'Kunming', name: 'Changshui' },
  { code: 'WUH', city: 'Wuhan', name: 'Tianhe' },
  { code: 'NKG', city: 'Nanjing', name: 'Lukou' },
  { code: 'TAO', city: 'Qingdao', name: 'Jiaodong' },
  { code: 'XMN', city: 'Xiamen', name: 'Gaoqi' },
  { code: 'CSX', city: 'Changsha', name: 'Huanghua' },
  // Asia hubs
  { code: 'ICN', city: 'Seoul', name: 'Incheon' },
  { code: 'NRT', city: 'Tokyo', name: 'Narita' },
  { code: 'HND', city: 'Tokyo', name: 'Haneda' },
  { code: 'KIX', city: 'Osaka', name: 'Kansai' },
  { code: 'HKG', city: 'Hong Kong', name: 'Hong Kong International' },
  { code: 'TPE', city: 'Taipei', name: 'Taoyuan' },
  { code: 'SIN', city: 'Singapore', name: 'Changi' },
  { code: 'BKK', city: 'Bangkok', name: 'Suvarnabhumi' },
  { code: 'MNL', city: 'Manila', name: 'Ninoy Aquino' },
  // Europe / Middle East hubs
  { code: 'LHR', city: 'London', name: 'Heathrow' },
  { code: 'CDG', city: 'Paris', name: 'Charles de Gaulle' },
  { code: 'FRA', city: 'Frankfurt', name: 'Frankfurt am Main' },
  { code: 'MUC', city: 'Munich', name: 'Franz Josef Strauss' },
  { code: 'AMS', city: 'Amsterdam', name: 'Schiphol' },
  { code: 'ZRH', city: 'Zurich', name: 'Kloten' },
  { code: 'VIE', city: 'Vienna', name: 'Schwechat' },
  { code: 'HEL', city: 'Helsinki', name: 'Vantaa' },
  { code: 'IST', city: 'Istanbul', name: 'Istanbul Airport' },
  { code: 'DOH', city: 'Doha', name: 'Hamad' },
  { code: 'DXB', city: 'Dubai', name: 'Dubai International' },
  { code: 'AUH', city: 'Abu Dhabi', name: 'Zayed' },
]

const byCode = new Map(AIRPORTS.map((a) => [a.code, a]))

export function airportInfo(code: string): AirportInfo | undefined {
  return byCode.get(code.toUpperCase())
}

export function suggestAirports(query: string, exclude: string[], limit = 6): AirportInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const excluded = new Set(exclude.map((c) => c.toUpperCase()))
  const scored = AIRPORTS.filter((a) => !excluded.has(a.code)).flatMap((a) => {
    const code = a.code.toLowerCase()
    const city = a.city.toLowerCase()
    const name = a.name.toLowerCase()
    let score = -1
    if (code === q) score = 0
    else if (code.startsWith(q)) score = 1
    else if (city.startsWith(q)) score = 2
    else if (city.includes(q) || name.toLowerCase().includes(q)) score = 3
    return score >= 0 ? [{ a, score }] : []
  })
  return scored.sort((x, y) => x.score - y.score).slice(0, limit).map((x) => x.a)
}
