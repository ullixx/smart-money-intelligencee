const BASE58_ALPHABET="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES=new Map([...BASE58_ALPHABET].map((character,index)=>[character,index]));
export function isValidSolanaAddress(value){
 if(typeof value!=="string"||value.length<32||value.length>44)return false;
 let decoded=0n;
 for(const character of value){const digit=BASE58_VALUES.get(character);if(digit===undefined)return false;decoded=decoded*58n+BigInt(digit);}
 let decodedBytes=0;while(decoded>0n){decoded>>=8n;decodedBytes++;}
 let leadingZeroBytes=0;while(leadingZeroBytes<value.length&&value[leadingZeroBytes]==="1")leadingZeroBytes++;
 return decodedBytes+leadingZeroBytes===32;
}
