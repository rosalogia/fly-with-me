const CARRIERS: Record<string, string> = {
  CA: 'Air China', MU: 'China Eastern', CZ: 'China Southern', HU: 'Hainan Airlines',
  MF: 'Xiamen Air', HO: 'Juneyao Air', '3U': 'Sichuan Airlines',
  UA: 'United', DL: 'Delta', AA: 'American', AS: 'Alaska', B6: 'JetBlue', WN: 'Southwest',
  AC: 'Air Canada', CX: 'Cathay Pacific', KE: 'Korean Air', OZ: 'Asiana',
  JL: 'Japan Airlines', NH: 'ANA', BR: 'EVA Air', CI: 'China Airlines',
  TK: 'Turkish Airlines', LH: 'Lufthansa', QR: 'Qatar Airways', EK: 'Emirates', EY: 'Etihad',
  AF: 'Air France', KL: 'KLM', BA: 'British Airways', LX: 'Swiss', OS: 'Austrian',
  SQ: 'Singapore Airlines', ZZ: 'Duffel Airways (test)',
}

export function carrierName(code: string): string {
  return CARRIERS[code] ?? code
}
