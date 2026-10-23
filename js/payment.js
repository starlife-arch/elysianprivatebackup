import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const note = document.getElementById('paymentMessage');

onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = '/auth/login/';
    return;
  }

  // A click is not proof of payment. Paid status must only be written by a
  // trusted server after the payment provider confirms the transaction.
  const showPaymentNotice = () => {
    if (note) {
      note.textContent = 'Please complete payment through the secure checkout page. Your account will activate after payment is verified.';
    }
    location.href = '/account/payment/';
  };

  const stripeButton = document.getElementById('stripePay');
  const pesapalButton = document.getElementById('pesapalPay');

  if (stripeButton) stripeButton.onclick = showPaymentNotice;
  if (pesapalButton) pesapalButton.onclick = showPaymentNotice;
});
