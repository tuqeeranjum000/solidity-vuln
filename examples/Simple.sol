// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Simple {
    mapping(address => uint256) public balances;

    function deposit() payable external {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }
}
