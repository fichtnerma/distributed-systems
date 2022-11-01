import fetch from "node-fetch";
import {Order} from "./types";

let orderNumber = 1;
const averageWaitingTimePerGuest = 4;

export async function processOrder(order: Order){
    const highestOrderPosition = await sendFoodToFoodPreparation(order);
    await sendOrderToDelivery(order);
    const waitingTime = calculateWaitingTime(highestOrderPosition);

    return { waitingTime, order: orderNumber - 1 }
}

async function sendOrderToDelivery(order: Order){
    const sentOrder = {
        guest: order.guest, 
        food: order.food, 
        drinks: order.drink || [], 
        order: orderNumber
    };
    fetch("http://Delivery:8084/orderInformation", {
        method: "POST",
        body: JSON.stringify(sentOrder),
        headers: {"Content-Type" : "application/json"}
    });
    orderNumber++;
}

async function sendFoodToFoodPreparation(order: Order){
    const foodOrder = order.food;
    let highestOrderPosition = 0;

    for(const foodId of foodOrder){
        const response = await fetch("http://FoodPreparation:8085/orderItem", {
            method: "POST",
            body: JSON.stringify({id: foodId, order: orderNumber}),
            headers: {"Content-Type" : "application/json"}
        });
        const orderPosition = await response.json();
        if(orderPosition > highestOrderPosition){
            highestOrderPosition = orderPosition;
        }
    }
    return highestOrderPosition;
}

function calculateWaitingTime(highestOrderPosition: number){
    let waitingTime = highestOrderPosition * averageWaitingTimePerGuest;
    return waitingTime;
}





