import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
const note=document.getElementById('paymentMessage');
const done=async(uid,provider)=>{await updateDoc(doc(db,'users',uid),{paid:true,status:'active_member',paymentProvider:provider}); note.textContent='Payment complete. Redirecting...'; setTimeout(()=>location.href='/app/dashboard/',900)};
onAuthStateChanged(auth,(user)=>{ if(!user) return location.href='/auth/login/'; document.getElementById('stripePay').onclick=()=>done(user.uid,'stripe'); document.getElementById('pesapalPay').onclick=()=>done(user.uid,'pesapal'); });
